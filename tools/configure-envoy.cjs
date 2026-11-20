// Idempotently add dedicated TLS listeners and an h2c gRPC cluster.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const file = path.join(__dirname, '../envoy/envoy.yaml');
const config = YAML.parse(fs.readFileSync(file, 'utf8'));
const resources = config.static_resources;
for (const [name, port, cluster] of [['https_h2_listener', 443, 'backend_cluster'], ['grpc_listener', 9443, 'grpc_cluster']]) {
  const listener = structuredClone(resources.listeners[0]);
  listener.name = name;
  listener.address.socket_address.port_value = port;
  const chain = listener.filter_chains[0];
  chain.transport_socket = {
    name: 'envoy.transport_sockets.tls',
    typed_config: {
      '@type': 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext',
      common_tls_context: {
        alpn_protocols: port === 443 ? ['h2', 'http/1.1'] : ['h2'],
        tls_params: { tls_minimum_protocol_version: 'TLSv1_2' },
        tls_certificates: [{ certificate_chain: { filename: '/etc/lb-certs/localhost.crt' }, private_key: { filename: '/etc/lb-certs/localhost.key' } }],
      },
    },
  };
  const manager = chain.filters[0].typed_config;
  manager.stat_prefix = name;
  manager.codec_type = 'AUTO';
  // Keep HTTP demo routes out of the benchmark listeners.
  manager.route_config.virtual_hosts[0].routes = [{ match: { prefix: '/' }, route: { cluster } }];
  resources.listeners = resources.listeners.filter(x => x.name !== name);
  resources.listeners.push(listener);
}
const grpcCluster = structuredClone(resources.clusters[0]);
grpcCluster.name = 'grpc_cluster';
grpcCluster.load_assignment.cluster_name = 'grpc_cluster';
for (const endpoint of grpcCluster.load_assignment.endpoints[0].lb_endpoints) endpoint.endpoint.address.socket_address.port_value = 50051;
grpcCluster.typed_extension_protocol_options = {
  'envoy.extensions.upstreams.http.v3.HttpProtocolOptions': {
    '@type': 'type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions',
    explicit_http_config: { http2_protocol_options: {} },
  },
};
resources.clusters = resources.clusters.filter(x => x.name !== 'grpc_cluster');
resources.clusters.push(grpcCluster);
fs.writeFileSync(file, YAML.stringify(config));
