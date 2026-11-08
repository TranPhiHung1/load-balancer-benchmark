const express = require("express");
const path = require('node:path');
const shared = require('node:fs').existsSync(path.join(__dirname, 'shared')) ? './shared' : '../shared';
require(`${shared}/grpc-server`)(require('@grpc/grpc-js'), require('@grpc/proto-loader'), 'backend-1');

const app = express();

const PORT = Number(process.env.REST_PORT || 3001);

app.get('/api', (req, res) => {
    res.json({
        message: 'Hello from Backend 1',
        port: 3001
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend 1 is running on port ${PORT}`);
});
