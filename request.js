module.exports = function(RED) {
    function nibeRequest(config) {
        RED.nodes.createNode(this,config);
        var reqOn = false;
        var absentReported = false;
        // Every pending timer, so close() can stop them from sending on a
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
            reqOn = false;
            for (const t of timers) clearTimeout(t);
            timers.clear();
        });
        this.server = RED.nodes.getNode(config.server);
        if (!this.server) {
            this.status({ fill: 'red', shape: 'dot', text: `No configuration node configured` });
            return;
        }
        let nibe = this.server.nibe;
        const suncalc = this.server.suncalc;
            this.on('input', function(msg) {
                let register = config.name;
                if(this.server.hP()[config.name]!==undefined) {
                    register = this.server.hP()[config.name]
                }
                if(register.toLowerCase()=="astro") {
                    later(() => {
                        this.status({ fill: 'yellow', shape: 'dot', text: `` });
                    }, 5000);
                    this.status({ fill: 'green', shape: 'dot', text: `Requesting astro data` });
                    msg.astro = suncalc(msg)
                    this.status({ fill: 'green', shape: 'dot', text: `` });
                    this.send(msg);
                } else if(register.toLowerCase()=="config") {
                    this.status({ fill: 'yellow', shape: 'dot', text: `Requesting configuration` });
                    let config = nibe.getConfig();
                    if(config!==undefined) {
                        this.status({ fill: 'green', shape: 'dot', text: `Received configuration` });
                        msg.config = config;
                        this.send([msg,{topic:config.name,payload:msg.config}]);
                    } else {
                        this.send(msg);
                        this.status({ fill: 'red', shape: 'dot', text: `Timeout requesting configuration` });
                    }
                  
                } else {
                    // The shared flows carry request nodes for every model (e.g. the
                    // energy meters 43144/43305 that the F1255 lacks). When the
                    // register table is loaded and doesn't have this register, pass
                    // the message on at once instead of firing a request that can
                    // only fail and then waiting 30 s for the timeout below.
                    const table = nibe.getRegister();
                    const conf = nibe.getConfig();
                    const testmode = conf!==undefined && conf.system!==undefined && conf.system.testmode===true;
                    if(!testmode && Array.isArray(table) && table.length>0 && !table.some(r => r.register == register)) {
                        if(absentReported===false) {
                            absentReported = true;
                            RED.log.debug(`[nibepi] Register ${register} (${config.name}) is not available on this heat pump model`);
                        }
                        this.status({ fill: 'grey', shape: 'ring', text: `Not on this model` });
                        this.send(msg);
                        return;
                    }
                    if(reqOn===false) {
                        reqOn = true;
                        // Exactly one of result, error or timeout answers this
                        // request; a late reply after the timeout is dropped
                        // instead of sending the message a second time.
                        let settled = false;
                        const settle = () => {
                            if(settled || closed) return false;
                            settled = true;
                            cancel(timer);
                            reqOn = false;
                            return true;
                        };
                        this.status({ fill: 'yellow', shape: 'dot', text: `Requesting data` });
                        nibe.reqData(register).then(result => {
                            if(!settle()) return;
                            this.status({ fill: 'green', shape: 'dot', text: `Value: ${result.data}${result.unit}` });
                            msg[config.name+"_raw"] = result;
                            msg[config.name] = result.data;
                            this.send([msg,{topic:config.name,payload:result.data}])
                            later(() => {
                                this.status({ fill: 'yellow', shape: 'dot', text: `` });
                            }, 10000);
                        }).catch((err) => {
                            if(!settle()) return;
                            const message = (err!==undefined && err!==null && err.message!==undefined) ? err.message : String(err);
                            // These nodes cover several pump models, so the ones for
                            // other models permanently miss on this one. Say that once
                            // instead of logging a raw Error object every trigger.
                            if(message.indexOf('not in database')!==-1) {
                                if(absentReported===false) {
                                    absentReported = true;
                                    this.warn(`Register ${register} is not available on this heat pump model`);
                                }
                                this.status({ fill: 'grey', shape: 'ring', text: `Not on this model` });
                            } else {
                                console.log(message)
                                this.status({ fill: 'red', shape: 'dot', text: `Could not get data.` });
                            }
                            // Pass the message on now, as the timeout below used
                            // to do 30 s later, with the reason attached.
                            msg.error = message;
                            this.send(msg);
                        })
                        const timer = later(() => {
                            if(!settle()) return;
                            msg.error = 'Timeout requesting data';
                            this.send(msg);
                            this.status({ fill: 'red', shape: 'dot', text: `Timeout requesting data` });
                        }, 30000);
                        
                    }
                    
                }
            });
    }
    RED.nodes.registerType("nibe-request",nibeRequest);
}
