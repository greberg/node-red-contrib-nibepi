
const { subscriber, serialized, coreConnected, applyConfigTopic } = require('./node_util');
module.exports = function(RED) {
    function nibeFan(config) {
        RED.nodes.createNode(this,config);
        const server = RED.nodes.getNode(config.server);
        // Subscriptions to the shared emitter: released on close, and a handler
        // exception is reported on this node instead of propagating into the
        // config node's emit() (see node_util.js).
        const sub = subscriber(this, server);
        const startUp = () => {
            let system = config.system.replace('s','S');
            this.status({ fill: 'yellow', shape: 'dot', text: `System ${system}` });
            const arr = [
                /*{topic:"bs1_flow",source:"nibe"},
                {topic:"fan_speed",source:"nibe"},
                {topic:"alarm",source:"nibe"},
                {topic:"vented",source:"nibe"},
                {topic:"cpr_set",source:"nibe"},
                {topic:"cpr_act",source:"nibe"}*/
            ];
            let conf = server.nibe.getConfig();
            if(conf.fan===undefined) {
                conf.fan = {};
                server.nibe.setConfig(conf);
            }
            /*
            if(conf.home.inside_sensors===undefined) {
                conf.home.inside_sensors = [];
                server.nibe.setConfig(conf);
            }
            if(conf.fan.sensor===undefined || conf.fan.sensor=="Ingen") {
                
            } else {
                let index = conf.home.inside_sensors.findIndex(i => i.name == conf.fan.sensor);
                if(index!==-1) {
                    var co2Sensor = Object.assign({}, conf.home.inside_sensors[index]);
                    arr.push(co2Sensor);
                }
            }*/
        return server.initiatePlugin(arr,'fan',config.system).then(data => {
            this.status({ fill: 'green', shape: 'dot', text: `System ${system}` });
            this.send({enabled:true});
        },(reject => {
            this.status({ fill: 'red', shape: 'dot', text: `System ${system}` });
            this.send({enabled:false});
        }));
        }
        // One startUp at a time; errors and rejections go to node.error.
        const start = serialized(this, startUp);
        this.on('input', function(msg) {
            let conf = server.nibe.getConfig();
            if(msg.topic=="update") {
                server.runFan();
                return;
            }
            if(msg.payload!==undefined && msg.topic!==undefined && msg.topic!=="") {
                // Only this node's own config categories are writable (see applyConfigTopic).
                const res = applyConfigTopic(conf, msg.topic, msg.payload, ['fan'], '');
                if(res.error!==undefined) {
                    this.error(res.error, msg);
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
        sub(this.id, (data) => {
            if(data.changed===true) {
                config.system = data.system;
                if(coreConnected(server)) start();
            }
        })
        sub('pluginFan', (data) => {
                let co2 = data.co2Sensor;
                let low_co2_limit = data.low_co2_limit;
                let high_co2_limit = data.high_co2_limit;
                if(co2!==undefined && co2.data!==undefined && co2.data.data>0) {
                    //this.send({topic:"CO2",payload:co2.data.data});
                }
                if(low_co2_limit!==undefined) {
                    //this.send({topic:"CO2 Gränsvärde för sänkt flöde.",payload:low_co2_limit});
                }
                if(high_co2_limit!==undefined) {
                    //this.send({topic:"CO2 Gränsvärde för ökat flöde.",payload:high_co2_limit});
                }
                if(data.filter_eff!==undefined) {
                    this.send({topic:"Filtereffektivitet",payload:data.filter_eff});
                }
                // A register read can fail and leave its entry undefined.
                if(data['fan_speed']!==undefined) this.send({topic:"Fläkthastighet",payload:data['fan_speed'].data});
                if(data['bs1_flow']!==undefined) this.send({topic:"Luftflöde",payload:data['bs1_flow'].data});
                this.send({topic:"Luftflöde Börvärde",payload:data.setpoint});
                if(data['cpr_act']!==undefined) this.send({topic:"Kompressorfrekvens",payload:data['cpr_act'].data});
                if(data['evaporator']!==undefined) this.send({topic:"Förångartemperatur",payload:data['evaporator'].raw_data});
        })

        this.on('close', function() {
            let system = config.system.replace('s','S');
            this.status({ fill: 'yellow', shape: 'dot', text: `System ${system}` });
        });
    }
    RED.nodes.registerType("nibe-fan",nibeFan);
}