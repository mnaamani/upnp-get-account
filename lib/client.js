var nat = require('./nat');

var client = exports;

function Client() {
	this.ssdp = nat.ssdp.create();
	this.timeout = 1800;
}

client.create = function create() {
	return new Client();
};

Client.prototype.findGateway = function findGateway(ip, callback) {
	var timeout;
	var timeouted = false;
	var p;

	if (typeof callback !== 'function') callback = function () {};
	if (ip) {
		if (typeof ip === 'function') {
			callback = ip;
			p = this.ssdp.search(
				'urn:schemas-upnp-org:device:InternetGatewayDevice:1', undefined
			);
		} else {
			p = this.ssdp.select(
				'urn:schemas-upnp-org:device:InternetGatewayDevice:1', undefined, ip
			);
		}
	} else {
		p = this.ssdp.search(
			'urn:schemas-upnp-org:device:InternetGatewayDevice:1', undefined
		);
	}

	timeout = setTimeout(function () {
		timeouted = true;
		p.emit('end');
		callback(new Error('timeout'));
	}, this.timeout);

	p.on('device', function (info, address, remote) {
		if (timeouted) return;
		p.emit('end');
		clearTimeout(timeout);

		// Create gateway
		callback(null, nat.device.create(info.location, address, remote), address);
	});
};

Client.prototype.close = function close() {
	this.ssdp.close();
};
