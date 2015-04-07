#!/usr/bin/env node

var nat = require('./lib/nat');

var ip = process.argv[2];

singleGateway(ip);

//discover gateway on the local network or specified by ip
function singleGateway(ip) {
	var client = nat.createClient();
	console.log("Looking for local gateway...", ip ? ip : "");

	function onGateway(err, gateway) {
		if (err) {
			console.error("error contacting gateway:", err.message);
			client.close();
			return;
		}
		console.error("gateway found:", gateway.description);
		getAccountInfo(gateway, function (err, username, password) {
			if (err) {
				console.error("error querying username and password:", err.message);
			} else {
				console.log("Gateway: %s  Username: %s  Password: %s", gateway.addr, username,
					password);
			}
			client.close();
		});
	}

	client.findGateway(ip, onGateway);
}

function getAccountInfo(gateway, callback) {
	gateway.getUserName(function (err, username) {
		if (err) {
			callback(err);
			return;
		}
		gateway.getPassword(function (err, password) {
			if (err) {
				callback(err);
				return;
			}
			callback(undefined, username, password);
		});
	});
}
