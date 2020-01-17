module.exports = function(RED)
{
	"use strict";

	function HueLight(config)
	{
		RED.nodes.createNode(this, config);

		var scope = this;
		let bridge = RED.nodes.getNode(config.bridge);
		let path = require('path');
		let moment = require('moment');
		let rgb = require('../utils/rgb');
		let rgbHex = require('rgb-hex');
		let hexRGB = require('hex-rgb');
		let colornames = require("colornames");
		let colornamer = require('color-namer');
		let getColors = require('get-image-colors');


		//
		// CHECK CONFIG
		if(bridge == null)
		{
			this.status({fill: "red", shape: "ring", text: "hue-light.node.not-configured"});
			return false;
		}

		//
		// UPDATE STATE
		if(typeof bridge.disableupdates != 'undefined'||bridge.disableupdates == false)
		{
			this.status({fill: "grey", shape: "dot", text: "hue-light.node.init"});
		}

		//
		// ON UPDATE
		if(config.lightid)
		{
			bridge.events.on('light' + config.lightid, function(light)
			{
				var brightnessPercent = 0;
				if(light.reachable)
				{
					if(light.on)
					{
						// CHECK IF LIGHT
						if(light.brightness)
						{
							brightnessPercent = Math.round((100/254)*light.brightness);
							scope.status({fill: "yellow", shape: "dot", text: RED._("hue-light.node.turned-on-percent",{percent:brightnessPercent}) });

						}
						else
						{
							// SMART PLUG
							brightnessPercent = -1;
							scope.status({fill: "yellow", shape: "dot", text: "hue-light.node.turned-on"});
						}
					}
					else
					{
						scope.status({fill: "grey", shape: "dot", text: "hue-light.node.turned-off"});
					}
				}
				else
				{
					scope.status({fill: "red", shape: "ring", text: "hue-light.node.not-reachable"});
				}

				// DETERMINE TYPE AND SEND STATUS
				var message = {};
				message.payload = {};
				message.payload.on = light.on;
				message.payload.brightness = brightnessPercent;
				message.payload.reachable = light.reachable;

				message.info = {};
				message.info.id = light.id;
				message.info.uniqueId = light.uniqueId;
				message.info.name = light.name;
				message.info.type = light.type;
				message.info.softwareVersion = light.softwareVersion;

				message.info.model = {};;
				message.info.model.id = light.model.id;
				message.info.model.manufacturer = light.model.manufacturer;
				message.info.model.name = light.model.name;
				message.info.model.type = light.model.type;
				message.info.model.colorGamut = light.model.colorGamut;
				message.info.model.friendsOfHue = light.model.friendsOfHue;

				if(light.xy)
				{
					var rgbColor = rgb.convertXYtoRGB(light.xy[0], light.xy[1], light.brightness);

					message.payload.rgb = rgbColor;
					message.payload.hex = rgbHex(rgbColor[0], rgbColor[1], rgbColor[2]);

					if(config.colornamer == true)
					{
						var cNamesArray = colornamer(rgbHex(rgbColor[0], rgbColor[1], rgbColor[2]));
						message.payload.color = cNamesArray.basic[0]["name"];
					}
				}

				if(light.colorTemp)
				{
					message.payload.colorTemp = light.colorTemp;
				}

				message.payload.updated = moment().format();
				if(!config.skipevents) { scope.send(message); }
			});
		}
		else
		{
			scope.status({fill: "grey", shape: "dot", text: "hue-light.node.universal"});
		}


		//
		// TURN ON / OFF LIGHT
		this.on('input', function(msg, send, done)
		{
			// Node-RED < 1.0
			send = send || function() { scope.send.apply(scope,arguments); }

			var tempLightID = (typeof msg.topic != 'undefined' && isNaN(msg.topic) == false && msg.topic.length > 0) ? parseInt(msg.topic) : config.lightid;

			// CHECK IF LIGHT ID IS SET
			if(tempLightID == false)
			{
				scope.error(RED._("hue-light.node.error-no-id"));
				return false;
			}

			// SIMPLE TURN ON / OFF LIGHT
			if(msg.payload == true || msg.payload == false)
			{
				if(tempLightID != false)
				{
					bridge.client.lights.getById(tempLightID)
					.then(light => {
						light.on = msg.payload;
						return bridge.client.lights.save(light);
					})
					.then(light => {
						if(light != false)
						{
							scope.sendLightStatus(light, send, done);
						}
					})
					.catch(error => {
						scope.error(error, msg);
						scope.status({fill: "red", shape: "ring", text: "hue-light.node.error-input"});
						if(done) { done(error); }
					});
				}
			}
			// TOGGLE ON / OFF
			else if(typeof msg.payload != 'undefined' && typeof msg.payload.toggle != 'undefined')
			{
				if(tempLightID != false)
				{
					bridge.client.lights.getById(tempLightID)
					.then(light => {
						light.on = (light.on) ? false : true;
						return bridge.client.lights.save(light);
					})
					.then(light => {
						if(light != false)
						{
							scope.sendLightStatus(light, send, done);
						}
					})
					.catch(error => {
						scope.error(error, msg);
						scope.status({fill: "red", shape: "ring", text: "hue-light.node.error-input"});
						if(done) { done(error); }
					});
				}
			}
			// ALERT EFFECT
			else if(typeof msg.payload != 'undefined' && typeof msg.payload.alert != 'undefined' && msg.payload.alert > 0)
			{
				bridge.client.lights.getById(tempLightID)
				.then(light => {
					scope.context().set('lightPreviousState', [light.on ? true : false, light.brightness, light.xy ? light.xy : false]);

					// SET ALERT COLOR
					if(light.xy)
					{
						if(typeof msg.payload.rgb != 'undefined')
						{
							light.xy = rgb.convertRGBtoXY(msg.payload.rgb, light.model.id);
						}
						else if(typeof msg.payload.hex != 'undefined')
						{
							var rgbResult = hexRGB((msg.payload.hex).toString());
							light.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], light.model.id);
						}
						else if(typeof msg.payload.color != 'undefined')
						{
							if(msg.payload.color == "random"||msg.payload.color == "any")
							{
								var randomColor = '#'+(Math.random()*0xFFFFFF<<0).toString(16);
								var rgbResult = hexRGB(randomColor);
								light.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], light.model.id);
							}
							else
							{
								var colorHex = colornames(msg.payload.color);
								if(colorHex)
								{
									var rgbResult = hexRGB(colorHex);
									light.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], light.model.id);
								}
							}
						}
						else
						{
							light.xy = rgb.convertRGBtoXY([255,0,0], light.model.id);
						}
					}

					// ACTIVATE
					light.on = true;
					light.brightness = 254;
					light.transitionTime = 0;
					return bridge.client.lights.save(light);
				})
				.then(light => {
					// ACTIVATE ALERT
					if(light != false)
					{
						light.alert = 'lselect';
						return bridge.client.lights.save(light);
					}
					else
					{
						return false;
					}
				})
				.then(light => {
					// TURN OFF ALERT
					if(light != false)
					{
						var lightPreviousState = scope.context().get('lightPreviousState');
						var alertSeconds = parseInt(msg.payload.alert);

						setTimeout(function() {
							light.on = lightPreviousState[0];
							light.alert = 'none';
							light.brightness = lightPreviousState[1];
							light.transitionTime = 2;

							if(lightPreviousState[2] != false)
							{
								light.xy = lightPreviousState[2];
							}

							bridge.client.lights.save(light);
						}, alertSeconds * 1000);
					}
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-light.node.error-input"});
					if(done) { done(error); }
				});
			}
			// ANIMATION STARTED?
			else if(typeof msg.animation != 'undefined' && msg.animation.status == true && msg.animation.restore == true)
			{
				bridge.client.lights.getById(tempLightID)
				.then(light => {
					scope.context().set('lightPreviousState', [light.on ? true : false, light.brightness, light.xy ? light.xy : false]);
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-light.node.error-input"});
					if(done) { done(error); }
				});
			}
			// ANIMATION STOPPED AND RESTORE ACTIVE?
			else if(typeof msg.animation != 'undefined' && msg.animation.status == false && msg.animation.restore == true)
			{
				bridge.client.lights.getById(tempLightID)
				.then(light => {
					var lightPreviousState = scope.context().get('lightPreviousState');
					light.on = lightPreviousState[0];
					light.alert = 'none';
					light.brightness = lightPreviousState[1];
					light.transitionTime = 2;

					if(lightPreviousState[2] != false)
					{
						light.xy = lightPreviousState[2];
					}

					bridge.client.lights.save(light);
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-light.node.error-input"});
					if(done) { done(error); }
				});
			}
			// EXTENDED TURN ON / OFF LIGHT
			else
			{
				bridge.client.lights.getById(tempLightID)
				.then(async (light) => {
					// SET LIGHT STATE
					if(typeof msg.payload.on != 'undefined')
					{
						light.on = msg.payload.on;
					}

					// SET BRIGHTNESS
					if(typeof msg.payload.brightness != 'undefined')
					{
						if(msg.payload.brightness > 100 || msg.payload.brightness < 0)
						{
							scope.error("Invalid brightness setting. Only 0 - 100 percent allowed");
							return false;
						}
						else if(msg.payload.brightness == 0)
						{
							light.on = false;
						}
						else
						{
							light.on = true;
							light.brightness = Math.round((254/100)*parseInt(msg.payload.brightness));
						}
					}
					else if(typeof msg.payload.incrementBrightness != 'undefined')
					{
						if (msg.payload.incrementBrightness > 0)
						{
							light.on = true;
						}
						light.incrementBrightness = Math.round((254/100)*parseInt(msg.payload.incrementBrightness));
					}

					// SET HUMAN READABLE COLOR OR RANDOM
					if(msg.payload.color && light.xy)
					{
						if(msg.payload.color == "random"||msg.payload.color == "any")
						{
							var randomColor = '#'+(Math.random()*0xFFFFFF<<0).toString(16);
							var rgbResult = hexRGB(randomColor);
							light.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], light.model.id);
						}
						else
						{
							var colorHex = colornames(msg.payload.color);
							if(colorHex)
							{
								var rgbResult = hexRGB(colorHex);
								light.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], light.model.id);
							}
						}
					}

					// SET RGB COLOR
					if(msg.payload.rgb && light.xy)
					{
						light.xy = rgb.convertRGBtoXY(msg.payload.rgb, light.model.id);
					}

					// SET HEX COLOR
					if(msg.payload.hex && light.xy)
					{
						var rgbResult = hexRGB((msg.payload.hex).toString());
						light.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], light.model.id);
					}

					// SET COLOR TEMPERATURE
					if(msg.payload.colorTemp && light.colorTemp)
					{
						let colorTemp = parseInt(msg.payload.colorTemp);
						if(colorTemp >= 153 && colorTemp <= 500)
						{
							light.colorTemp = parseInt(msg.payload.colorTemp);
						}
						else
						{
							scope.error("Invalid color temprature. Only 153 - 500 allowed");
							return false;
						}
					}

					// SET SATURATION
					if(msg.payload.saturation && light.saturation)
					{
						if(msg.payload.saturation > 100 || msg.payload.saturation < 0)
						{
							scope.error("Invalid saturation setting. Only 0 - 254 allowed");
							return false;
						}
						else
						{
							light.saturation = Math.round((254/100)*parseInt(msg.payload.saturation));
						}
					}

					// SET TRANSITION TIME
					if(typeof msg.payload.transitionTime != 'undefined')
					{
						light.transitionTime = parseFloat(msg.payload.transitionTime);
					}

					// SET COLORLOOP EFFECT
					if(msg.payload.colorloop && msg.payload.colorloop > 0 && light.xy)
					{
						light.effect = 'colorloop';

						// DISABLE AFTER
						setTimeout(function() {
							light.effect = 'none';
							bridge.client.lights.save(light);
						}, parseFloat(msg.payload.colorloop)*1000);
					}

					// SET DOMINANT COLORS FROM IMAGE
					if(msg.payload.image && light.xy)
					{
						var colors = await getColors(msg.payload.image);
						if(colors.length > 0)
						{
							var colorsHEX = colors.map(color => color.hex());
							var rgbResult = hexRGB(colorsHEX[0]);
							light.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], light.model.id);
						}
					}

					return bridge.client.lights.save(light);
				})
				.then(light => {
					if(light != false)
					{
						// TRANSITION TIME? WAIT…
						if(typeof msg.payload.transitionTime != 'undefined')
						{
							setTimeout(function() {
								scope.sendLightStatus(light, send, done);
							}, parseFloat(msg.payload.transitionTime)*1010);
						}
						else
						{
							scope.sendLightStatus(light, send, done);
						}
					}
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-light.node.error-input"});
					if(done) { done(error); }
				});
			}
		});


		//
		// SEND LIGHT STATUS
		this.sendLightStatus = function(light, send, done)
		{
			var scope = this;
			var brightnessPercent = 0;

			if(light.on)
			{
				brightnessPercent = Math.round((100/254)*light.brightness);
				scope.status({fill: "yellow", shape: "dot", text: RED._("hue-light.node.turned-on-percent",{percent:brightnessPercent}) });
			}
			else
			{
				scope.status({fill: "grey", shape: "dot", text: "hue-light.node.turned-off"});
			}

			// DETERMINE TYPE AND SEND STATUS
			var message = {};
			message.payload = {};
			message.payload.on = light.on;
			message.payload.brightness = brightnessPercent;

			message.info = {};
			message.info.id = light.id;
			message.info.uniqueId = light.uniqueId;
			message.info.name = light.name;
			message.info.type = light.type;
			message.info.softwareVersion = light.softwareVersion;

			message.info.model = {};;
			message.info.model.id = light.model.id;
			message.info.model.manufacturer = light.model.manufacturer;
			message.info.model.name = light.model.name;
			message.info.model.type = light.model.type;
			message.info.model.colorGamut = light.model.colorGamut;
			message.info.model.friendsOfHue = light.model.friendsOfHue;

			if(light.xy)
			{
				var rgbColor = rgb.convertXYtoRGB(light.xy[0], light.xy[1], light.brightness);

				message.payload.rgb = rgbColor;
				message.payload.hex = rgbHex(rgbColor[0], rgbColor[1], rgbColor[2]);

				if(config.colornamer == true)
				{
					var cNamesArray = colornamer(rgbHex(rgbColor[0], rgbColor[1], rgbColor[2]));
					message.payload.color = cNamesArray.basic[0]["name"];
				}
			}

			if(light.colorTemp)
			{
				message.payload.colorTemp = light.colorTemp;
			}

			message.payload.updated = moment().format();
			if(!config.skipevents) { send(message); }
			if(done) { done(); }
		}

		//
		// CLOSE NODE / REMOVE EVENT LISTENER
		this.on('close', function()
		{
			bridge.events.removeAllListeners('light' + config.lightid);
		});
	}

	RED.nodes.registerType("hue-light", HueLight);
}