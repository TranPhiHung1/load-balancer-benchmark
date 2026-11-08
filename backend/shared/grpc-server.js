const path = require('node:path');

module.exports = function startGrpc(grpc, loader, backend) {
  const definition = loader.loadSync(path.join(__dirname, '../proto/greeter.proto'));
  const api = grpc.loadPackageDefinition(definition).benchmark;
  const server = new grpc.Server();
  server.addService(api.GreeterService.service, {
    sayHello(call, callback) {
      callback(null, { message: `Hello ${call.request.name}`, backend });
    },
  });
  server.bindAsync(`0.0.0.0:${process.env.GRPC_PORT || 50051}`,
    grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) { console.error(error); process.exit(1); }
      console.log(`${backend} gRPC listening on ${port} (h2c)`);
    });
  return server;
};
