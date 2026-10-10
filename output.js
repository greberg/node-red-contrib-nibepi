const { parseRegisterValue } = require('./node_util');
module.exports = function(RED) {
    function nibeOutput(config) {
        RED.nodes.createNode(this,config);
        // Every pending timer, so close() can stop them from touching a
        // closed node.
        const timers = new Set();
        const later = (fn, ms) => {
            const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
            timers.add(t);
            return t;
        };
        const cancel = (t) => { clearTimeout(t); timers.delete(t); };
        let closed = false;
        this.on('close', function() {
            closed = true;
            for (const t of timers) clearTimeout(t);
            timers.clear();
        });
        this.server = RED.nodes.getNode(config.server);
        if (!this.server) {
            this.status({ fill: 'red', shape: 'dot', text: `No configuration node configured` });
            return;
        }
        const nibe = this.server.nibe;
        // Write value to register. The value is validated first: setData
        // multiplies it by the register factor, so a non-numeric payload would
        // go to the pump as NaN/garbage. sendMsg is what goes out on success.
        const writeRegister = (register, payload, sendMsg, origMsg) => {
            const value = parseRegisterValue(payload);
            if(value===undefined) {
                this.status({ fill: 'red', shape: 'dot', text: `Invalid value: ${payload}` });
                this.error(`Not sending ${JSON.stringify(payload)} to register ${register}: not a number`, origMsg);
                return;
            }
            this.status({ fill: 'yellow', shape: 'dot', text: `${value}` });
            let timedOut = false;
            let done = false;
            const timeout = later(() => {
                timedOut = true;
                this.status({ fill: 'red', shape: 'dot', text: `Timeout setting data` });
            }, 10000);
            nibe.setData(register,value,(err,result) => {
                // setData should call back once; ignore any extra call.
                if(done || closed) return;
                done = true;
                cancel(timeout);
                if(err) {
                    this.status({ fill: 'red', shape: 'dot', text: `Error setting data` });
                    this.error(err, origMsg);
                    return;
                }
                if(result===true) {
                    if(timedOut!==true) {
                        sendMsg.payload = value;
                        this.send(sendMsg);
                        this.status({ fill: 'green', shape: 'dot', text: `${value}` });
                        later(() => {
                            this.status({ fill: 'yellow', shape: 'dot', text: `` });
                        }, 10000);
                    }
                } else {
                    this.status({ fill: 'red', shape: 'dot', text: `Timeout setting data` });
                }
            });
        };
        this.on('input', function(msg) {
                let register = config.name;
            if(this.server.hP()[config.name]!==undefined) {
                register = this.server.hP()[config.name]
            }
            if(config.name===undefined || config.name=="") {
                register = msg.topic
                if(this.server.hP()[msg.topic]!==undefined) {
                    register = this.server.hP()[msg.topic]
                }
            }
                if(msg.topic=="getConfig" || config.name=="getConfig") {
                    nibe.getConfig();
                } else if(msg.topic=="setConfig" || config.name=="setConfig") {
                   nibe.setConfig(msg.payload);
                } else if(msg.topic=="refreshConfig" || config.name=="refreshConfig") {
                    nibe.refreshConfig();
                    this.status({ fill: 'green', shape: 'dot', text: `Refreshing configuration` });
                    later(() => {
                        this.status({ fill: 'yellow', shape: 'dot', text: `` });
                    }, 10000);
                 } else if(msg.topic=="addSensor" || config.name=="addSensor") {
                    nibe.addSensor(msg.payload);
                } else if(msg.topic=="removeSensor" || config.name=="removeSensor") {
                    nibe.removeSensor(msg.payload);
                } else if(msg.topic=="addRegister" || config.name=="addRegister") {
                    nibe.addRegister(msg.payload)
                } else if(msg.topic=="getRegister" || config.name=="getRegister") {
                    nibe.getRegister();
                } else if(msg.topic=="removeRegister" || config.name=="removeRegister") {
                    nibe.removeRegister(msg.payload);
                } else if(msg.topic=="saveGraph" || config.name=="saveGraph") {
                    this.status({ fill: 'yellow', shape: 'dot', text: `Sparar grafer...` });
                    this.server.saveGraph().then(result => {
                        this.send({topic:msg.topic,payload:result});
                        this.status({ fill: 'green', shape: 'dot', text: `${result}` });
                    },(err => {
                        this.send({topic:msg.topic,payload:err});
                        this.status({ fill: 'red', shape: 'dot', text: `${err}` });
                    }));
                    
                } else if(config.name===undefined || config.name=="") {
                    writeRegister(register, msg.payload, {topic:msg.topic}, msg);
                } else {
                    writeRegister(register, msg.payload, {topic:register}, msg);
                }
            });
    }
    RED.nodes.registerType("nibe-output",nibeOutput);
}