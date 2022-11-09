"use strict";

const Gpio = require('onoff').Gpio;
const loadJsonFile = require('load-json-file');
const { EventEmitter } = require('events');

// pigeon enable gpio
const ENABLE = 34;
const USERLED = 45;
// gpio addresses
const GPIO = {
  inputs: {
    ID1: 30,
    ID2: 31,
    ID3: 32,
    ID4: 33,
    "I1+": 12,
    "I2+": 13,
    "I3+": 18,
    "I4+": 19,
    "I5+": 20,
    "I6+": 21,
    "I7+": 22,
    "I8+": 23
  },
  outputs: {
    O1: 35,
    O2: 36,
    O3: 37,
    O4: 38,
    O5: 39,
    O6: 40,
    O7: 41,
    O8: 42
  }
};

module.exports = async function (app) {
  try {
    app.pigeonio.config = [];
    const config = await loadJsonFile(`${app.configDir}/pigeonio.json`);
    app.pigeonio.state = {};
    if (!app.pigeonio.emitter) app.pigeonio.emitter = new EventEmitter();

    // check for outputs to enable the driver in the Pigeon hardware
    if (config.hasOwnProperty('outputs')) {
      const outputs = Object.keys(config.outputs);
      if (outputs.length > 0) {
        app.pigeonio.config.push({
          name: "OUT_ENABLE",
          gpio: ENABLE,
          type: "output",
          init: 0
        });

        app.pigeonio.config.push({
          name: "OUT_USERLED",
          gpio: USERLED,
          type: "output",
          init: 0
        });

        // setup outputs
        outputs.forEach( (out) => {
          app.pigeonio.config.push({
            name: `OUT_${config.outputs[out].name}`,
            gpio: GPIO.outputs[out],
            type: "output",
            init: config.outputs[out].init === "high" ? 1 : 0,
          });
        });
      }
    }

    // check for inputs
    if (config.hasOwnProperty('inputs')) {
      const inputs = Object.keys(config.inputs);
      if (inputs.length > 0) {
        // setup inputs
        inputs.forEach( (inp) => {
          app.pigeonio.config.push({
            name: `IN_${config.inputs[inp].name}`,
            gpio: GPIO.inputs[inp],
            type: "input",
            edge: config.inputs[inp].edge
          });
        });
      }
    }
  } catch (error) {
    app.logger.error(`pigeonio ${error.message}`);
    return;
  }
    
  // validate
  app.pigeonio.config = await require(`./validation`)(app.pigeonio.config);
  
  const isDev = process.env.NODE_ENV === 'development';

  app.pigeonio.config.forEach(io => {
    app.logger.debug(`setup BCM ${io.gpio} (${io.name}) as ${io.type}`);
    if (io.type === 'output') {
      try {
        app.pigeonio.state[io.name] = {
          gpio: isDev ? null : new Gpio(io.gpio, "out"),
          state: io.init
        };
        if (io.hasOwnProperty('init')) {
          // app.logger.debug(`setup ${io.name} ${io.init}`);
          if (!isDev) {
            app.pigeonio.state[io.name].gpio.writeSync(io.init);
          }
        }
      } catch (error) {
        app.logger.error(`setup BCM ${io.name} ${error.message}`);
      }
      // manage inputs
    } else if (io.type === 'input') {
      try {          
        app.pigeonio.state[io.name] = {
          gpio: isDev ? null : new Gpio(
            io.gpio,
            "in",
            io.edge,
            io.debounce
          )
        };
      } catch (error) {
        app.logger.error(`setup BCM ${io.name} ${error.message}`);
      }
      if (!isDev) {
        // watch the gpio for changes
        app.pigeonio.state[io.name].gpio.watch( async (err, value) => {
          if (err) {
            app.logger.error(`raspberry-gpio ${io.name} gpio ${io.gpio}`, err);
            app.pigeonio.emitter.emit("error", `raspberry-gpio ${io.name} gpio ${io.gpio}, ${err}`);
            return;
          }
          // check value
          if (value) {
            app.pigeonio.state[io.name].state = 1;
            // app.logger.debug(`${io.name} = 1`);
            app.pigeonio.emitter.emit("data", { name: io.name, value: 1 });
          } else {
            app.pigeonio.state[io.name].state = 0;
            // app.logger.debug(`${io.name} = 0`);
            app.pigeonio.emitter.emit("data", { name: io.name, value: 0 });
          }
        });
      }
    }
  });

  // the read function
  app.pigeonio.read = async () => {
    if (!app.pigeonio.data) app.pigeonio.data = {};

    if (process.env.NODE_ENV === 'development') {
      const { dirname } = require('path');
      const appDir = dirname(require.main.filename);
      try {        
        app.pigeonio.data = 
          await require(`${appDir}/apps/${process.env.APP}/devdata/pigeonio.json`)
        return app.pigeonio.data
      } catch (error) {
        return { IN: {}, OUT: {}}
      }
    }

    for (const item of app.pigeonio.config) {
        if (app.pigeonio.state.hasOwnProperty(item.name)) {
          if (app.pigeonio.state[item.name].gpio) {
            const split = item.name.split('_');
            const type = split[0];
            const name = split[1];
            if (!app.pigeonio.data[type]) app.pigeonio.data[type] = {};
            app.pigeonio.data[type][name] = await app.pigeonio.state[item.name].gpio.readSync();
          }
        } else {
          if (item.name !== 'OUT_USERLED')
            app.logger.error(`pigeonio ${item.name} does not exists`);
        }
    }
  
    return app.pigeonio.data;
  };

  // the read function
  app.pigeonio.write = async (output, value) => {
    if (app.pigeonio.state[`OUT_${output}`].gpio) {
      // set a gpio output
     await app.pigeonio.state[`OUT_${output}`].gpio.writeSync(value);
    } else {
      app.logger.error(`pigeonio output ${output} does not exists`);
    }
  };

  // first read
  app.pigeonio.read();
};
