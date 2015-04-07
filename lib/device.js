var nat = require('./nat'),
	request = require('request'),
	url = require('url'),
	xml2js = require('xml2js'),
	Buffer = require('buffer').Buffer,
	async = require('async');

var device = exports;

function Device(url, addr, remote) {
	this.description = url;
	this.local_addr = addr; //ip address of local inteface that found the gateway
	this.addr = remote.address + ":" + remote.port;
	this.services = [
		'urn:schemas-upnp-org:service:WANIPConnection:1',
		'urn:schemas-upnp-org:service:WANPPPConnection:1'
	];
};

device.create = function create(url, addr, remote) {
	return new Device(url, addr, remote);
};

Device.prototype._getXml = function _getXml(url, callback) {
	var once = false;

	function respond(err, body) {
		if (once) return;
		once = true;

		callback(err, body);
	}

	request(url, function (err, res, body) {
		if (err) return callback(err);

		if (res.statusCode !== 200) {
			respond(Error('Failed to lookup device description'));
			return;
		}

		var parser = new xml2js.Parser();
		parser.parseString(body, function (err, body) {
			if (err) return respond(err);

			respond(null, body);
		});
	});
};

Device.prototype.getService = function getService(types, callback) {
	var self = this;

	this._getXml(this.description, function (err, info) {
		if (err) return callback(err);

		var s = self.parseDescription(info).services.filter(function (service) {
			return types.indexOf(service.serviceType) !== -1;
		});

		if (s.length === 0 || !s[0].controlURL || !s[0].SCPDURL) {
			return callback(Error('Service not found'));
		}

		var base = url.parse(info.baseURL || self.description);

		function prefix(u) {
			var uri = url.parse(u);

			uri.host = uri.host || base.host;
			uri.protocol = uri.protocol || base.protocol;

			return url.format(uri);
		}

		callback(null, {
			service: s[0].serviceType,
			SCPDURL: prefix(s[0].SCPDURL),
			controlURL: prefix(s[0].controlURL)
		});
	});
};

Device.prototype.parseDescription = function parseDescription(info) {
	var services = [],
		devices = [];

	function toArray(item) {
		return Array.isArray(item) ? item : [item];
	};

	function traverseServices(service) {
		if (!service) return;
		services.push(service);
	}

	function traverseDevices(device) {
		if (!device) return;
		devices.push(device);

		if (device.deviceList && device.deviceList.device) {
			toArray(device.deviceList.device).forEach(traverseDevices);
		}

		if (device.serviceList && device.serviceList.service) {
			toArray(device.serviceList.service).forEach(traverseServices);
		}
	}

	traverseDevices(info.device);

	return {
		services: services,
		devices: devices
	};
};

Device.prototype.run = function run(action, args, callback) {
	var self = this;

	this.getService(this.services, function (err, info) {
		if (err) return callback(err);

		var body = '<?xml version="1.0"?>' +
			'<s:Envelope ' +
			'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
			's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
			'<s:Body>' +
			'<u:' + action + ' xmlns:u=' +
			JSON.stringify(info.service) + '>' +
			args.map(function (args) {
				return '<' + args[0] + '>' +
					(args[1] === undefined ? '' : args[1]) +
					'</' + args[0] + '>';
			}).join('') +
			'</u:' + action + '>' +
			'</s:Body>' +
			'</s:Envelope>';

		request({
			method: 'POST',
			url: info.controlURL,
			headers: {
				'Content-Type': 'text/xml; charset="utf-8"',
				'Content-Length': Buffer.byteLength(body),
				'Connection': 'close',
				'SOAPAction': JSON.stringify(info.service + '#' + action)
			},
			body: body
		}, function (err, res, body) {
			if (err) return callback(err);

			var parser = new xml2js.Parser();
			parser.parseString(body, function (err, body) {
				if (res.statusCode !== 200) {
					return callback(Error('Request failed: ' + res.statusCode));
				}

				var soapns = nat.utils.getNamespace(
					body,
					'http://schemas.xmlsoap.org/soap/envelope/');

				callback(null, body[soapns + 'Body']);
			});
		});
	});
};

Device.prototype.getUserName = function getUserName(callback) {
	this.run('GetUserName', [], function (err, data) {
		if (err) return callback(err);
		var key;

		Object.keys(data).some(function (k) {
			if (!/:GetUserNameResponse$/.test(k)) return false;

			key = k;
			return true;
		});

		if (!key) return callback(Error('Incorrect response'));
		callback(null, data[key].NewUserName);
	});
};

Device.prototype.getPassword = function getPassword(callback) {
	this.run('GetPassword', [], function (err, data) {
		if (err) return callback(err);
		var key;

		Object.keys(data).some(function (k) {
			if (!/:GetPasswordResponse$/.test(k)) return false;

			key = k;
			return true;
		});

		if (!key) return callback(Error('Incorrect response'));
		callback(null, data[key].NewPassword);
	});
};

function normalizeOptions(options) {
	function toObject(addr) {
		if (typeof addr === 'number') return {
			port: addr
		};
		if (typeof addr === 'object') return addr;

		return {};
	}

	return {
		remote: toObject(options.public),
		internal: toObject(options.private)
	};
}

Device.prototype.portMapping = function portMapping(options, callback) {
	if (!callback) callback = function () {};
	var gateway = this;
	var ports = normalizeOptions(options);

	gateway.run('AddPortMapping', [
		['NewRemoteHost', ports.remote.host],
		['NewExternalPort', ports.remote.port],
		['NewProtocol', options.protocol ?
			options.protocol.toUpperCase() : 'TCP'
		],
		['NewInternalPort', ports.internal.port],
		['NewInternalClient', ports.internal.host || gateway.local_addr],
		['NewEnabled', 1],
		['NewPortMappingDescription', options.description || 'node:nat:upnp'],
		['NewLeaseDuration', typeof options.ttl === 'number' ?
			options.ttl : 60 * 30
		]
	], callback);

};

Device.prototype.portUnmapping = function portMapping(options, callback) {
	if (!callback) callback = function () {};
	var ports = normalizeOptions(options);

	this.run('DeletePortMapping', [
		['NewRemoteHost', ports.remote.host],
		['NewExternalPort', ports.remote.port],
		['NewProtocol', options.protocol ?
			options.protocol.toUpperCase() : 'TCP'
		]
	], callback);
};

Device.prototype.getMappings = function getMappings(options, callback) {
	if (typeof options === 'function') {
		callback = options;
		options = null;
	}

	if (!options) options = {};
	var gateway = this;

	var i = 0;
	var end = false;
	var results = [];

	async.whilst(function () {
		return !end;
	}, function (callback) {
		gateway.run('GetGenericPortMappingEntry', [
			['NewPortMappingIndex', ++i]
		], function (err, data) {
			if (err) {
				end = true;
				return callback(null);
			}

			var key;
			Object.keys(data).some(function (k) {
				if (!/:GetGenericPortMappingEntryResponse/.test(k)) return false;

				key = k;
				return true;
			});
			data = data[key];

			var result = {
				public: {
					host: typeof data.NewRemoteHost === 'string' &&
						data.NewRemoteHost || '',
					port: parseInt(data.NewExternalPort, 10)
				},
				private: {
					host: data.NewInternalClient,
					port: parseInt(data.NewInternalPort, 10)
				},
				protocol: data.NewProtocol.toLowerCase(),
				enabled: data.NewEnabled === 1,
				description: data.NewPortMappingDescription,
				ttl: parseInt(data.NewLeaseDuration, 10)
			};
			result.local = result.private.host === gateway.local_addr;

			results.push(result);

			callback(null);
		});
	}, function (err) {
		if (err) return callback(err);

		if (options.local) {
			results = results.filter(function (item) {
				return item.local;
			});
		}

		if (options.description) {
			results = results.filter(function (item) {
				if (options.description instanceof RegExp) {
					return item.description.match(options.description) !== null;
				} else {
					return item.description.indexOf(options.description) !== -1;
				}
			});
		}

		callback(null, results);
	});
};

Device.prototype.externalIp = function externalIp(callback) {
	this.run('GetExternalIPAddress', [], function (err, data) {
		if (err) return callback(err);
		var key;

		Object.keys(data).some(function (k) {
			if (!/:GetExternalIPAddressResponse$/.test(k)) return false;

			key = k;
			return true;
		});

		if (!key) return callback(Error('Incorrect response'));
		callback(null, data[key].NewExternalIPAddress);
	});
};
