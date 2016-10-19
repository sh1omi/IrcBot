const net = require('net');
const tls  = require('tls');
const fs = require('fs');
const http = require('http');
const dateFormat = require('dateformat');
const codes = require('./codes');

let config = require('./config.js');
config.messageSplit = 512;

let cmd = {},permissions = {};

let client;
if(config.secure) {
    client = tls.connect(config.port, config.server, () => {
        console.log('client connected',client.authorized ? 'authorized' : 'unauthorized');
        ConnectionHandler();
    });
}
else {
    client = new net.Socket().connect(config.port, config.server, () => {
        ConnectionHandler();
    });
}

let buffer = new Buffer('');
client.on('data', (chunk) => {
    if (typeof (chunk) === 'string') buffer += chunk;
    else buffer = Buffer.concat([buffer, chunk]);
    let lines = buffer.split(new RegExp('\r\n|\r|\n'));
    if (lines.pop()) return;
    else buffer = new Buffer('');
    lines.forEach(function iterator(line) {
        if (line.length) {
            let message;
            try{
                message = parse(line);
            }catch(err){
                return console.log(err);
            }
            switch(message.command){
                case 'CAP':
                    if(message.args[1]=="ACK" && message.args[2]=="sasl ") client.write("AUTHENTICATE PLAIN\n");
                    break;
                case 'AUTHENTICATE':
                    if(message.args[0]=="+") client.write("AUTHENTICATE "+new Buffer(config.nick + '\0' +config.username + '\0' +config.sasl).toString('base64')+"\n");
                    break;
                case '903':
                    client.write("CAP END\n");
                    break;
                case 'PING':
                    client.write("PONG "+message.args[0]+"\n");
                    break;
                case 'PART':
                    if(message.nick==config.nick) delete client.channels[message.args[0]];
                    break;
                case 'KICK':
                    if(message.nick==config.nick) delete client.channels[message.args[0]];
                    break;
                case 'PRIVMSG':
                    if(config.nick != message.nick){
                        if (message.args[1].charCodeAt(0) === 1 && message.args[1].charCodeAt(message.args[1].length-1) == 1) {
                            CTCPHandler(message);
                        }else{
                            if(config.nick == message.args[0]) message.args[0] = message.nick;
                            if(message.args[1].charAt(0)=='!'){ // You can change the prefix '!'
                                console.log("["+dateFormat(new Date(), "HH:MM:ss")+" / "+message.args[0]+"] "+message.nick+": "+message.args[1]);
                                message.params = message.args[1].split(" ");
                                message.cmd = message.params[0].toLowerCase();
                                let command = message.cmd.substr(1);
                                message.params.shift();
                                if (typeof cmd[command] != "undefined") {
                                    let level = 1;
                                    if(typeof permissions[message.host] != "undefined") level = permissions[message.host];
                                    if(typeof cmd[command][0] == "function") {
                                        if(level >= cmd[command][1]) cmd[command][0](client,message);
                                        else client.msg(message.args[0], "You dont have enough power to do the command: "+command);
                                    }else {
                                        if(level >= cmd[cmd[command]][1]) cmd[cmd[command]][0](client,data);
                                        else client.msg(message.args[0], "You dont have enough power to do the command: "+command);
                                    }
                                }else client.msg(message.args[0], "Hmm, you need help? type @help :)");
                            }
                        }
                    }
                    break;
                case '311': //rpl_whoisuser
                    if(client.nick == message.args[1]){
                        config.host = message.args[3];
                        UpdateMaxLineLength();
                    }
                    break;
                case '353': //rpl_namreply
                    client.channels[message.args[2]] = [];
                    client.channels[message.args[2]].push(message.args[3]);
                    break;
                case '376': //rpl_endofmotd
                     for(let i=0;i<config.channels.length;i++){
                        client.join(config.channels[i]);
                     }
                    break;
                case '433': //err_nicknameinuse
                    message.args[1] += Math.floor(Math.random() * 100);
                    client.SetNick(message.args[1]);
                    break;
                default:
                    // console.log(message); You can enable this for debugging
                    break;
            }
        }
    });
});

client.on('close', () => {
    console.log('Connection closed');
});

/* Functions */
let SetUser = (username,realname) =>{
    client.write("USER "+username+" 8 * :"+realname+"\n");
}

client.SetNick = (nick) =>{
    client.write("NICK "+nick+"\n");
    client.nick = nick;
}

client.join = (channel) =>{
    client.write("JOIN "+channel+"\n");
}

client.leave = (channel) =>{
    client.write("PART "+channel+"\n");
}

client.msg = (channel,text)=>{
    say("PRIVMSG",channel,text);
}

client.notice = (channel,text)=>{
    say("NOTICE",channel,text);
}

let ConnectionHandler = () =>{
    console.log('CONNECTED TO: ' + config.server + ':' + config.port);
    client.setEncoding('utf8');
    if(config.password) client.write("PASSWORD "+config.password+"\n");
    SetUser(config.username,config.realname);
    if(config.sasl) client.write("CAP REQ :sasl\n");
    client.SetNick(config.nick);
    client.write("WHOIS "+config.nick+"\n");
    LoadModules();
    client.channels = {};
}

let CTCPHandler = (data) =>{
    data.args[1] = data.args[1].substring(1, data.args[1].length-1);
    switch(data.args[1]){
        case 'VERSION':
            client.notice("NOTICE",data.nick,"\u0001 Example \u0001");
            break;
        case 'TIME':
            client.notice("NOTICE",data.nick,"\u0001TIME "+dateFormat(new Date(), "HH:MM:ss dd/mm/yyyy o")+"\u0001");
            break;
        case 'EXAMPLE':
            client.notice("NOTICE",data.nick,"\u0001 Example 2 \u0001");
            break;
    }
}

let say = (type="PRIVMSG",channel,text) =>{
    try{
        SplitLines(channel, text).forEach((toSend) => {
            client.write(type+" "+channel+" :"+text+"\n");
        });
    }catch(err){
        console.log(err);
    }
}

let SplitLines = (target, text) => {
    let maxLength = Math.min(config.maxLineLength - target.length, config.messageSplit);
    return text.toString().split(/\r?\n/).filter((line) =>{
            return line.length > 0;
        }).map((line) => {
            return SplitLongLines(line, maxLength, []);
        }).reduce((a, b) => {
            return a.concat(b);
        }, []);
};

let SplitLongLines = (words, maxLength, destination) => {
    maxLength = maxLength || 450;
    if (words.length == 0) {
        return destination;
    }
    if (words.length <= maxLength) {
        destination.push(words);
        return destination;
    }
    let c = words[maxLength];
    let cutPos;
    let wsLength = 1;
    if (c.match(/\s/)) {
        cutPos = maxLength;
    } else {
        let offset = 1;
        while ((maxLength - offset) > 0) {
            let c = words[maxLength - offset];
            if (c.match(/\s/)) {
                cutPos = maxLength - offset;
                break;
            }
            offset++;
        }
        if (maxLength - offset <= 0) {
            cutPos = maxLength;
            wsLength = 0;
        }
    }
    let part = words.substring(0, cutPos);
    destination.push(part);
    return SplitLongLines(words.substring(cutPos + wsLength, words.length), maxLength, destination);
};

let UpdateMaxLineLength = () => {
    config.maxLineLength = 497 - config.nick.length - config.host.length;
};

let parse = (line) =>{
    let message = {};
    let match;
    match = line.match(/^:([^ ]+) +/);
    if (match) {
        message.prefix = match[1];
        line = line.replace(/^:[^ ]+ +/, '');
        match = message.prefix.match(/^([_a-zA-Z0-9\[\]\\`^{}|-]*)(!([^@]+)@(.*))?$/);
        if (match) {
            message.nick = match[1];
            message.user = match[3];
            message.host = match[4];
        }
        else {
            message.server = message.prefix;
        }
    }
    match = line.match(/^([^ ]+) */);
    message.command = match[1];
    line = line.replace(/^[^ ]+ +/, '');
    message.args = [];
    let middle, trailing;
    if (line.search(/^:|\s+:/) != -1) {
        match = line.match(/(.*?)(?:^:|\s+:)(.*)/);
        middle = match[1].trimRight();
        trailing = match[2];
    }
    else {
        middle = line;
    }
    if (middle.length)
        message.args = middle.split(/ +/);
    if (typeof (trailing) != 'undefined' && trailing.length)
        message.args.push(trailing);
    return message;
}

let LoadModules = () =>{
    let help = "";
    cmd = {};
    fs.readdirSync(require("path").join(__dirname, "commands")).forEach(function(file) {
        delete require.cache[require.resolve("./commands/" + file)];
        let command = require("./commands/" + file);
        console.log(file+" loaded.");
        for (let i = 0;i < command.length; i++) {
            cmd[command[i].alias[0]] = [];
            cmd[command[i].alias[0]][0] = command[i].action;
            cmd[command[i].alias[0]][1] = command[i].level;
            help += "@"+command[i].alias[0];
            if(command[i].alias.length!=1){
                help += "(";
                for (let y = 1;y < command[i].alias.length; y++) {
                    cmd[command[i].alias[y]] = command[i].alias[0];
                    help += "@"+command[i].alias[y]+", ";
                }
            help = help.substring(0, help.length-2) + ")";
        }
        help += ", ";
    }
    });
    help += " !level, !reload"; // Need to add manually the extra commands

    /* Extra Commands */
    cmd['help'] = [];
    cmd['help'][0] = (client,data) => {
        client.msg(data.args[0],help);
    };
    cmd['help'][1] = 1;

    cmd['level'] = [];
    cmd['level'][0] = (client,data) => {
        let params = data.args[1].split(' ');
        if(data.params.length!=3) client.msg(data.args[0],params[0]+" [host] [level]");
        else{
        if(isNaN(data.params[2])) return client.msg(data.args[0],params[0]+" [host] [Must be a number]");
        let levels;
        levels = JSON.parse(fs.readFileSync('data/permissions.json', 'utf8'));
        levels[data.params[1]] = parseInt(data.params[2]);
        fs.writeFile('data/permissions.json', JSON.stringify(levels), function(err) {
            if(err) return console.log(err);
            client.msg(data.args[0],data.params[1]+" is now level "+data.params[2]);
        });
        permissions = levels;
        }
    };
    cmd['level'][1] = 10;

    cmd['reload'] = [];
    cmd['reload'][0] = (client,data) => {
        LoadModules();
        client.msg(data.args[0], Object.keys(cmd).length + " commands loaded");
    };
    cmd['reload'][1] = 10;

    fs.writeFile("data/help.json", help, function(err) {
        if(err) return console.log(err);
    });
}

/* Permissions files */
fs.writeFile("data/permissions.json", "{}", { flag: 'wx' }, function (err) {
    if(err.code != "EEXIST") return console.log(err);
});
fs.readFile("data/permissions.json", "utf8", function (err,data) {
  if (err) return console.log(err);
  permissions = JSON.parse(data);
});
