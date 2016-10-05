'use strict';
module.exports = [
  {
    alias:['exmaple'],
    level: 1,
    action: (client,data) => {
      client.msg(data.args[0],"example");
    }
  },
  {
    alias:['example2'],
    level: 1,
    action: (client,data) => {
      client.msg(data.args[0],"example2 :)");
    }
  }
];
