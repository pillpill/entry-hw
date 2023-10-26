function Module() {
    this.sp = null;
    this.sensorTypes = {
        ALIVE: 0,
        DIGITAL: 1,
        ANALOG: 2,
        PWM: 3,
        SERVO_PIN: 4,
        TONE: 5,
        PULSE_IN: 6,
        ULTRASONIC: 7,
        TIMER: 8,
		NEOPIXEL_INIT: 9, 
		NEOPIXEL_COLOR: 10,     
		DHT_INIT: 21,
		DHT_TEMP: 22,
		DHT_HUMI: 23,
		NO_TONE: 24,
		LCD_INIT: 41,
		LCD: 42,
		LCD_CLEAR: 43,
		LCD_EMOTICON: 44,
    };

    this.actionTypes = {
        GET: 1,
        SET: 2,
        RESET: 3,
        MODULE:4,
    };

    this.sensorValueSize = {
        FLOAT: 2,
        SHORT: 3,
        STRING : 4,
        SHORTSHORT: 5,
    };

    this.digitalPortTimeList = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    this.sensorData = {
        ULTRASONIC: 0,
		DHT_TEMP: 0,
		DHT_HUMI: 0,
        DIGITAL: {
            '0': 0,
            '1': 0,
            '2': 0,
            '3': 0,
            '4': 0,
            '5': 0,
            '6': 0,
            '7': 0,
            '8': 0,
            '9': 0,
            '10': 0,
            '11': 0,
            '12': 0,
            '13': 0,
        },
        ANALOG: {
            '0': 0,
            '1': 0,
            '2': 0,
            '3': 0,
            '4': 0,
            '5': 0,
        },
        PULSE_IN: {},
        TIMER: 0,
    };
    this.defaultOutput = {};
    this.recentCheckData = {};
    this.sendBuffers = [];
    this.lastTime = 0;
    this.lastSendTime = 0;
    this.isDraing = false;
}

var sensorIdx = 0;
Module.prototype.init = function(handler, config) {};
Module.prototype.setSerialPort = function(sp) {
    var self = this;
    this.sp = sp;
};

Module.prototype.requestInitialData = function() {
    return this.makeSensorReadBuffer(this.sensorTypes.ANALOG, 0);
};

Module.prototype.checkInitialData = function(data, config) {
    return true;   
};

Module.prototype.afterConnect = function(that, cb) {
    //cb 은 화면의 이벤트를 보내는 로직. 
    //connected 라는 신호를 보내 강제로 연결됨 화면으로 전환
    that.connected = true;
    if (cb) {
        cb('connected');
    }
};

Module.prototype.validateLocalData = function(data) {
    return true;
};

Module.prototype.requestRemoteData = function(handler) {
    var self = this;
    if (!self.sensorData) {
        return;
    }
    Object.keys(this.sensorData).forEach(function(key) {
        if (self.sensorData[key] != undefined) {
            handler.write(key, self.sensorData[key]);
        }
    });
};

Module.prototype.handleRemoteData = function(handler) {
    var self = this;
    var getDatas = handler.read('GET');
    var setDatas = handler.read('SET') || this.defaultOutput;
    var time = handler.read('TIME');
    var buffer = new Buffer([]);

    if (getDatas) {
        var keys = Object.keys(getDatas);
        keys.forEach(function(key) {
            var isSend = false;
            var dataObj = getDatas[key];
            if (
                typeof dataObj.port === 'string' ||
                typeof dataObj.port === 'number'
            ) {
                var time = self.digitalPortTimeList[dataObj.port];
                if (dataObj.time > time) {
                    isSend = true;
                    self.digitalPortTimeList[dataObj.port] = dataObj.time;
                }
            } else if (Array.isArray(dataObj.port)) {
                isSend = dataObj.port.every(function(port) {
                    var time = self.digitalPortTimeList[port];
                    return dataObj.time > time;
                });

                if (isSend) {
                    dataObj.port.forEach(function(port) {
                        self.digitalPortTimeList[port] = dataObj.time;
                    });
                }
            }

            if (isSend) {
                if (!self.isRecentData(dataObj.port, key, dataObj.data)) {
                    self.recentCheckData[dataObj.port] = {
                        type: key,
                        data: dataObj.data,
                    };
                    buffer = Buffer.concat([
                        buffer,
                        self.makeSensorReadBuffer(
                            key,
                            dataObj.port,
                            dataObj.data
                        ),
                    ]);
                }
            }
        });
    }

    if (setDatas) {
        var setKeys = Object.keys(setDatas);
        setKeys.forEach(function(port) {
            var data = setDatas[port];
            if (data) {
                if (self.digitalPortTimeList[port] < data.time) {
                    self.digitalPortTimeList[port] = data.time;

                    if (!self.isRecentData(port, data.type, data.data)) {
                        self.recentCheckData[port] = {
                            type: data.type,
                            data: data.data,
                        };
                        buffer = Buffer.concat([
                            buffer,
                            self.makeOutputBuffer(data.type, port, data.data),
                        ]);
                    }
                }
            }
        });
    }

    if (buffer.length) {
        this.sendBuffers.push(buffer);
    }
};

Module.prototype.isRecentData = function(port, type, data) {
    var that = this;
    var isRecent = false;

    if(type == this.sensorTypes.ULTRASONIC || type == this.sensorTypes.DHTTEMP || type == this.sensorTypes.DHTHUMI  || type == this.sensorTypes.PMVALUE) {
        var portString = port.toString();
        var isGarbageClear = false;
        Object.keys(this.recentCheckData).forEach(function (key) {
            var recent = that.recentCheckData[key];
            if(key === portString) {
                
            }
            if(key !== portString && (recent.type == that.sensorTypes.ULTRASONIC || recent.type == that.sensorTypes.DHTTEMP || recent.type == that.sensorTypes.DHTHUMI || recent.type == that.sensorTypes.PMVALUE)) {
                delete that.recentCheckData[key];
                isGarbageClear = true;
            }
        });

        if((port in this.recentCheckData && isGarbageClear) || !(port in this.recentCheckData)) {
            isRecent = false;
        } else {
            isRecent = true;
        }
        
    } else if (port in this.recentCheckData && type != this.sensorTypes.TONE) {
        if (
            this.recentCheckData[port].type === type &&
            this.recentCheckData[port].data === data
        ) {
            isRecent = true;
        }
    }

    return isRecent;
};

Module.prototype.requestLocalData = function() {
    var self = this;

    if (!this.isDraing && this.sendBuffers.length > 0) {
        this.isDraing = true;
        this.sp.write(this.sendBuffers.shift(), function() {
            if (self.sp) {
                self.sp.drain(function() {
                    self.isDraing = false;
                });
            }
        });
    }

    return null;
};

/*
ff 55 idx size data a
*/
Module.prototype.handleLocalData = function(data) {
    var self = this;
    var datas = this.getDataByBuffer(data);

    datas.forEach(function(data) {
        if (data.length <= 4 || data[0] !== 255 || data[1] !== 85) {
            return;
        }
        var readData = data.subarray(2, data.length);
        var value;
        switch (readData[0]) {
            case self.sensorValueSize.FLOAT: {
                value = new Buffer(readData.subarray(1, 5)).readFloatLE();
                value = Math.round(value * 100) / 100;
                break;
            }
            case self.sensorValueSize.SHORT: {
                value = new Buffer(readData.subarray(1, 3)).readInt16LE();
                break;
            }
            default: {
                value = 0;
                break;
            }
        }

        var type = readData[readData.length - 1];
        var port = readData[readData.length - 2];

        switch (type) {
            case self.sensorTypes.DIGITAL: {
                self.sensorData.DIGITAL[port] = value;
                break;
            }
            case self.sensorTypes.ANALOG: {
                self.sensorData.ANALOG[port] = value;
                break;
            }
            case self.sensorTypes.PULSE_IN: {
                self.sensorData.PULSE_IN[port] = value;
                break;
            }
            case self.sensorTypes.ULTRASONIC: {
                self.sensorData.ULTRASONIC = value;
                break;
            }
			case self.sensorTypes.DHT_TEMP: {
                self.sensorData.DHT_TEMP = value;
				//console.log(value);
                break;
            }
			case self.sensorTypes.DHT_HUMI: {
                self.sensorData.DHT_HUMI = value;
				console.log(value);
                break;
            }
			case self.sensorTypes.PM_VALUE: {
                self.sensorData.PM_VALUE = value;
				//console.log(value);
                break;
            }
            case self.sensorTypes.TIMER: {
                self.sensorData.TIMER = value;
                break;
            }
            default: {
                break;
            }
        }
    });
};

/*
ff 55 len idx action device port  slot  data a
0  1  2   3   4      5      6     7     8
*/

Module.prototype.makeSensorReadBuffer = function(device, port, data) {
    var buffer;
    var dummy = new Buffer([10]);
    if (device == this.sensorTypes.ULTRASONIC) {
        buffer = new Buffer([
            255,
            85,
            6,
            sensorIdx,
            this.actionTypes.GET,
            device,
            port[0],
            port[1],
            10,
        ]);
		//console.log(buffer);
    } else if (device == this.sensorTypes.DHT_TEMP) {
        buffer = new Buffer([
            255,
            85,
            5,
            sensorIdx,
            this.actionTypes.GET,
            device,
            port,
            10,
        ]);
		//console.log(buffer);
    } else if (device == this.sensorTypes.DHT_HUMI) {
        buffer = new Buffer([
            255,
            85,
            6,
            sensorIdx,
            this.actionTypes.GET,
            device,
            port,
            10,
        ]);
		console.log(buffer);
    }else if (device == this.sensorTypes.PM_VALUE) {
        buffer = new Buffer([
            255,
            85,
            5,
            sensorIdx,
            this.actionTypes.GET,
            device,
            port,
            10,
        ]);
		//console.log(buffer);
    } else if (!data) {
        buffer = new Buffer([
            255,
            85,
            5,
            sensorIdx,
            this.actionTypes.GET,
            device,
            port,
            10,
        ]);
    } else {
        value = new Buffer(2);
        value.writeInt16LE(data);
        buffer = new Buffer([
            255,
            85,
            7,
            sensorIdx,
            this.actionTypes.GET,
            device,
            port,
            10,
        ]);
        buffer = Buffer.concat([buffer, value, dummy]);
    }
    sensorIdx++;
    if (sensorIdx > 254) {
        sensorIdx = 0;
    }
	//console.log(buffer);
    return buffer;
};

//0xff 0x55 0x6 0x0 0x1 0xa 0x9 0x0 0x0 0xa
Module.prototype.makeOutputBuffer = function(device, port, data) {
    var buffer;
    var value = new Buffer(2);
    var dummy = new Buffer([10]);
    switch (device) {
        case this.sensorTypes.SERVO_PIN:
        case this.sensorTypes.DIGITAL:
        case this.sensorTypes.PWM: {
            value.writeInt16LE(data);
            buffer = new Buffer([
                255,
                85,
                6,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, dummy]);
			//console.log(buffer);                
            break;
        }
        case this.sensorTypes.TONE: {
            var time = new Buffer(2);
            if ($.isPlainObject(data)) {
                value.writeInt16LE(data.value);
                time.writeInt16LE(data.duration);
            } else {
                value.writeInt16LE(0);
                time.writeInt16LE(0);
            }
            buffer = new Buffer([
                255,
                85,
                8,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, time, dummy]);
            break;
        }
        case this.sensorTypes.TONE: {
        }
		case this.sensorTypes.NO_TONE:  {
            value.writeInt16LE(data);
			
            buffer = new Buffer([
                255,
                85,
                6,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, dummy]);
			//console.log(buffer);
            break;
        }
		case this.sensorTypes.NEOPIXEL_INIT:  {
            value.writeInt16LE(data);

			//console.log(port);
			//console.log(value);                
			
            buffer = new Buffer([
                255,
                85,
                6,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, dummy]);
            break;
        }

		case this.sensorTypes.NEOPIXEL_COLOR: {
			
            var num = new Buffer(2);
            var r = new Buffer(2);
			var g = new Buffer(2);
			var b = new Buffer(2);
			
			if($.isPlainObject(data))
            {
				num.writeInt16LE(data.num);
				r.writeInt16LE(data.r);
				g.writeInt16LE(data.g);
				b.writeInt16LE(data.b);
			}
			else 
			{
                num.writeInt16LE(0);
                r.writeInt16LE(0);
				g.writeInt16LE(0);
				b.writeInt16LE(0);
            }
			
            buffer = new Buffer([
                255,
                85,
                12,
                sensorIdx,
                this.actionTypes.SET,
                device,
				port,
            ]);
            buffer = Buffer.concat([buffer, num, r, g, b, dummy]);
			console.log(buffer);
            break;
		}
		case this.sensorTypes.DHT_INIT:  {
            value.writeInt16LE(data);
			
            buffer = new Buffer([
                255,
                85,
                6,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, dummy]);
			//console.log(buffer);
            break;
        }	
		
		case this.sensorTypes.LCD_INIT:  {
            value.writeInt16LE(data);			
            buffer = new Buffer([
                255,
                85,
                6,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, dummy]);
			//console.log(buffer);       
            break;
        }
		
		case this.sensorTypes.LCD:  {
			var row = new Buffer(2);
            var col = new Buffer(2);

            if($.isPlainObject(data)) {
				row.writeInt16LE(data.row);
                col.writeInt16LE(data.col);
            } else {
				row.writeInt16LE(0);
                col.writeInt16LE(0);
            }
            var text0 = new Buffer(2);
            var text1 = new Buffer(2);
            var text2 = new Buffer(2);
            var text3 = new Buffer(2);
            var text4 = new Buffer(2);
            var text5 = new Buffer(2);
            var text6 = new Buffer(2);
            var text7 = new Buffer(2);
            var text8 = new Buffer(2);
            var text9 = new Buffer(2);
            var text10 = new Buffer(2);
            var text11 = new Buffer(2);
            var text12 = new Buffer(2);
            var text13 = new Buffer(2);
            var text14 = new Buffer(2);
            var text15 = new Buffer(2);
            if($.isPlainObject(data)) {
                text0.writeInt16LE(data.text0);
                text1.writeInt16LE(data.text1);
                text2.writeInt16LE(data.text2);
                text3.writeInt16LE(data.text3);
                text4.writeInt16LE(data.text4);
                text5.writeInt16LE(data.text5);
                text6.writeInt16LE(data.text6);
                text7.writeInt16LE(data.text7);
                text8.writeInt16LE(data.text8);
                text9.writeInt16LE(data.text9);
                text10.writeInt16LE(data.text10);
                text11.writeInt16LE(data.text11);
                text12.writeInt16LE(data.text12);
                text13.writeInt16LE(data.text13);
                text14.writeInt16LE(data.text14);
                text15.writeInt16LE(data.text15);
            } else {
                text0.writeInt16LE(0);
                text1.writeInt16LE(0);
                text2.writeInt16LE(0);
                text3.writeInt16LE(0);
                text4.writeInt16LE(0);
                text5.writeInt16LE(0);
                text6.writeInt16LE(0);
                text7.writeInt16LE(0);
                text8.writeInt16LE(0);
                text9.writeInt16LE(0);
                text10.writeInt16LE(0);
                text11.writeInt16LE(0);
                text12.writeInt16LE(0);
                text13.writeInt16LE(0);
                text14.writeInt16LE(0);
                text15.writeInt16LE(0);
            }

            buffer = new Buffer([255, 85, 40, sensorIdx, this.actionTypes.SET, device, port]);
            buffer = Buffer.concat([buffer, row, col, text0, text1, text2, text3, text4, text5, text6, text7, text8, text9, text10,text11, text12, text13, text14, text15,dummy]);

			//console.log(buffer);       
            break;
        }
		
		case this.sensorTypes.LCD_CLEAR:  {
            value.writeInt16LE(data);			
            buffer = new Buffer([
                255,
                85,
                6,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, dummy]);
			console.log(buffer);       
            break;
        }
		
		case this.sensorTypes.LCD_EMOTICON:  {
            var row = new Buffer(2);
            var col = new Buffer(2);
			var emoticon = new Buffer(2);
			
			if($.isPlainObject(data)) {
				row.writeInt16LE(data.row);
                col.writeInt16LE(data.col);
				emoticon.writeInt16LE(data.emoticon);
            } else {
				row.writeInt16LE(0);
                col.writeInt16LE(0);
				emoticon.writeInt16LE(0);
            }
			
            buffer = new Buffer([
                255,
                85,
                10,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, row, col, emoticon, dummy]);
			console.log(buffer);       
            break;
        }
    }

    return buffer;
};

Module.prototype.getDataByBuffer = function(buffer) {
    var datas = [];
    var lastIndex = 0;
    buffer.forEach(function(value, idx) {
        if (value == 13 && buffer[idx + 1] == 10) {
            datas.push(buffer.subarray(lastIndex, idx));
            lastIndex = idx + 2;
        }
    });

    return datas;
};

Module.prototype.disconnect = function(connect) {
    var self = this;
    connect.close();
    if (self.sp) {
        delete self.sp;
    }
};

Module.prototype.reset = function() {
    this.lastTime = 0;
    this.lastSendTime = 0;

    this.sensorData.PULSE_IN = {};
};

module.exports = new Module();
