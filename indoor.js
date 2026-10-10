
const { subscriber, serialized, coreConnected, applyConfigTopic } = require('./node_util');
module.exports = function(RED) {
    function nibeIndoor(config) {
        RED.nodes.createNode(this,config);
        let node = this;
        const server = RED.nodes.getNode(config.server);
        // Subscriptions to the shared emitter: released on close, and a handler
        // exception is reported on this node instead of propagating into the
        // config node's emit() (see node_util.js).
        const sub = subscriber(this, server);
        async function startUp() {
            let system = config.system.replace('s','S');
            let conf = server.nibe.getConfig();
            node.status({ fill: 'yellow', shape: 'dot', text: `System ${system}` });
            let arr = [
                //{topic:"inside_"+config.system,source:"nibe"},
                {topic:"inside_set_"+config.system,source:"nibe"},
                {topic:"inside_enable_"+config.system,source:"nibe"},
                {topic:"inside_factor_"+config.system,source:"nibe"},
                {topic:"exhaust",source:"nibe"},
                {topic:"outside",source:"nibe"}
            ];
            const pump = conf.system!==undefined ? conf.system.pump : undefined;
            if(pump!=="F370" && pump!=="F470") {
                arr.push({topic:"dM",source:"nibe"});
                arr.push({topic:"dMstart",source:"nibe"})
            }
            if(conf.indoor===undefined) {
                conf.indoor = {};
                server.nibe.setConfig(conf);
            }
            if(conf.home===undefined) conf.home = {};
            if(conf.home.inside_sensors===undefined) {
                conf.home.inside_sensors = [];
                server.nibe.setConfig(conf);
            }
            if(conf.indoor['sensor_'+config.system]===undefined || conf.indoor['sensor_'+config.system]=="Ingen") {
                arr.push({topic:"inside_"+config.system,source:"nibe"});
            } else {
                let index = conf.home.inside_sensors.findIndex(i => i.name == conf.indoor['sensor_'+config.system]);
                if(index!==-1) {
                    var insideSensor = Object.assign({}, conf.home.inside_sensors[index]);
                    
                    
                    arr.push(insideSensor);
                }
            }
            let nibe_enabled;
            try {
                nibe_enabled = await server.nibe.reqData(server.hP()["inside_enable_"+config.system]);
            } catch (err) {
                if (err && err.message === 'Heatpump is not ready yet.') {
                    // The core emits 'ready' when the serial port opens, before the
                    // pump has announced its model. startUp() runs again on the
                    // next 'ready', so wait quietly instead of logging a stack.
                    node.status({ fill: 'yellow', shape: 'ring', text: 'Waiting for heat pump' });
                    return;
                }
                node.warn(err && err.message ? err.message : String(err));
            }
            if(nibe_enabled===undefined || nibe_enabled.data===undefined || nibe_enabled.data!==1 && conf.indoor['enable_'+config.system]!==true){ arr = [];}
                return server.initiatePlugin(arr,'indoor',config.system).then(data => {
                    node.status({ fill: 'green', shape: 'dot', text: `System ${system}` });
                    node.send({enabled:true});
                },(reject => {
                    node.status({ fill: 'red', shape: 'dot', text: `System ${system}` });
                    node.send({enabled:false});
                }));
        }
        // One startUp at a time; errors and rejections go to node.error.
        const start = serialized(node, startUp);
        node.on('input', function(msg) {
            let conf = server.nibe.getConfig();
            if(msg.topic=="update") {
                server.updateData();
                return;
            }
            if(msg.payload!==undefined && msg.topic!==undefined && msg.topic!=="") {
                // Only this node's own config categories are writable (see applyConfigTopic).
                const res = applyConfigTopic(conf, msg.topic, msg.payload, ['indoor'], '_'+config.system);
                if(res.error!==undefined) {
                    node.error(res.error, msg);
                    return;
                }
                if(res.changed) server.nibe.setConfig(conf);
                start();
            }
            
        });
        // Restart on every 'ready' (reconnect, sensor list change), not only when
        // the node was created before the pump connected: after a partial
        // redeploy the plugin would otherwise never restart on a reconnect.
        sub('ready', () => start());
        if(coreConnected(server)) start();
        sub(node.id, (data) => {
            if(data.changed===true) {
                config.system = data.system;
                if(coreConnected(server)) start();
            }
        })
        // A core fault means the pump link is down: show it until the next
        // 'ready' restarts the plugin (startUp sets the status again).
        sub('fault', (data) => {
            if(data===undefined || data===null || data.from!=="core") return;
            node.status({ fill: 'red', shape: 'ring', text: `System ${config.system.replace('s','S')}: core fault` });
        });
        sub('pluginIndoor', (data) => {
            if(data.system===config.system) {
                let outside = data['outside'];
                let inside = data.indoorSensor;
                
                if(inside===undefined) inside = data['inside_'+data.system];
                if(inside!==undefined && inside.data>-3276) {
                    node.send({topic:"Inomhustemperatur",payload:inside.data});
                }
                if(data.indoorOffset!==undefined) {
                    node.send({topic:"Kurvjustering",payload:data.indoorOffset});
                }
                if(outside!==undefined) node.send({topic:"Tid",payload:outside.timestamp});
                node.send({topic:"Avvikelse",payload:data.accuracy});
            }
        })

        node.on('close', function(removed) {

            // A deleted plugin node must stop feeding its registers to the control loop.

            if(removed===true && server && typeof server.clearList==='function') server.clearList('indoor',config.system);
            let system = config.system.replace('s','S');
            node.status({ fill: 'yellow', shape: 'dot', text: `System ${system}` });
        });
    }
    RED.nodes.registerType("nibe-indoor",nibeIndoor);
}