var upnp = require('./lib/nat');

var client = upnp.createClient();

console.log("Looking for gateway...");

client.findGateway(function (err, device) {
	var username, password;

	if (err) {
		console.log("Error finding gateway:", err.message);
		client.close();
		return;
	}

	console.log("Gateway found:", device.description);
	console.log("Querying connection username and password...");

	client.getUserName(function (err, user) {
		username = user;
		if (err) console.log("Error getting username:", err.message);
	});

	client.getPassword(function (err, pwd) {
		password = pwd;
		if (err) console.log("Error getting password:", err.message);
	});

	setTimeout(function () {
		client.close();
		if (username && password) {
			console.log("Username:", username);
			console.log("Password:", password);
		} else console.log("Unable to retrieve username and password");
	}, 1500);
});
