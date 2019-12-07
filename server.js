const powernap = require('powernap.js');

const app = new powernap(80);

app.staticEndpoint('/', './');