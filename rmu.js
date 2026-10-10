
const { subscriber, serialized, coreConnected, applyConfigTopic } = require('./node_util');
module.exports = function(RED) {
    function nibeRMU(config) {
        RED.nodes.createNode(this,config);
        const server = RED.nodes.getNode(config.server);
        // Subscriptions to the shared emitter: released on close, and a handler
        // exception is reported on this node instead of propagating into the
        // config node's emit() (see node_util.js).
        const sub = subscriber(this, server);
        
        let announced = false;
        const startUp = () => {
            let system = config.system.replace('s','S');
            this.status({ fill: 'yellow', shape: 'dot', text: `RMU 40 ${system}` });
            const arr = [
            ];
            let conf = server.nibe.getConfig();
            if(conf.rmu===undefined) {
                conf.rmu = {};
                server.nibe.setConfig(conf);
            }
            if(conf.home===undefined) conf.home = {};
            if(conf.home.inside_sensors===undefined) {
                conf.home.inside_sensors = [];
                server.nibe.setConfig(conf);
            }
            if(conf.rmu['sensor_'+config.system]===undefined || conf.rmu['sensor_'+config.system]=="Ingen") {
                arr.push({topic:"inside_"+config.system,source:"nibe"});
            } else {
                let index = conf.home.inside_sensors.findIndex(i => i.name == conf.rmu['sensor_'+config.system]);
                if(index!==-1) {
                    var insideSensor = Object.assign({}, conf.home.inside_sensors[index]);
                    //let insideSensor = conf.home.inside_sensors[index];
                    arr.push(insideSensor);
                }
            }
        return server.initiatePlugin(arr,'rmu',config.system).then(data => {
            this.status({ fill: 'green', shape: 'dot', text: `RMU 40 ${system}` });
            // startUp re-runs on every 'ready'/'rmu_ready'; only announce the
            // connection when it is new.
            if(announced===false) {
                announced = true;
                server.sendError('RMU 40',`RMU 40 ${system} ${server.text.sys_connected}`);
            }
            this.send({enabled:true});
        },(reject => {
            announced = false;
            this.status({ fill: 'red', shape: 'dot', text: `RMU 40 ${system}` });
            this.send({enabled:false});
        }));
        }
        // One startUp at a time; errors and rejections go to node.error.
        const start = serialized(this, startUp);
        this.send({enabled:false});
        this.on('input', function(msg) {
            let conf = server.nibe.getConfig();
            if(msg.topic=="update") {
                server.updateData();
                return;
            }
            if(msg.payload!==undefined && msg.topic!==undefined && msg.topic!=="") {
                // Only this node's own config categories are writable (see applyConfigTopic).
                const res = applyConfigTopic(conf, msg.topic, msg.payload, ['rmu'], '_'+config.system);
                if(res.error!==undefined) {
                    this.error(res.error, msg);
                    return;
                }
                if(res.changed) server.nibe.setConfig(conf);
                start();
            }
            
        });

        // Both through sub() so they are released on close (a bare once()
        // leaked across redeploys), and through start() so the two arriving
        // together run startUp once - it used to run twice and toast
        // "RMU connected" twice.
        sub('rmu_ready', () => start());
        sub('ready', () => start());
        if(server.checkRMU()===true || coreConnected(server)) start();
        sub(this.id, (data) => {
            if(data.changed===true) {
                config.system = data.system;
                if(coreConnected(server)) start();
            }
        })
        // A core fault means the pump link is down: show it until the next
        // 'ready' restarts the plugin (startUp sets the status again).
        sub('fault', (data) => {
            if(data===undefined || data===null || data.from!=="core") return;
            announced = false;
            this.status({ fill: 'red', shape: 'ring', text: `RMU 40 ${config.system.replace('s','S')}: core fault` });
        });
        sub('pluginRMU', (data) => {
            if(data.system===config.system) {
                if(data.rmuSensor!==undefined) this.send({topic:"Inomhustemperatur",payload:data.rmuSensor.data});
            }
        })

        this.on('close', function(removed) {

            // A deleted plugin node must stop feeding its registers to the control loop.

            if(removed===true && server && typeof server.clearList==='function') server.clearList('rmu',config.system);
            let system = config.system.replace('s','S');
            this.status({ fill: 'yellow', shape: 'dot', text: `RMU 40 ${system}` });
        });
    }
    RED.nodes.registerType("nibe-rmu",nibeRMU);
}