'use strict';

const Config = require('getconfig');
const Hapi = require('hapi');
const Muckraker = require('muckraker');
const Pkg = require('./package.json');

const Utils = require('./lib/utils');

const db = new Muckraker(Config.db);

Config.hapi.cache.engine = require(Config.hapi.cache.engine);

const server = new Hapi.Server(Config.hapi);

//$PORT is not set during postinstall, so we can't
//include it in the config, hence this if statement
//$lab:coverage:off$
if (process.env.NODE_ENV === 'production') {
  Config.connection.public.port = process.env.PORT;
}
//$lab:coverage:on$
server.connection(Config.connection.public);

//$lab:coverage:off$
process.on('SIGTERM', () => {

  server.log(['info', 'shutdown'], 'Graceful shutdown');
  server.stop({ timeout: Config.shutdownTimeout }).then(() => {

    return process.exit(0);
  });
});

if (process.env.NODE_ENV !== 'production') {
  server.on('request-error', (err, m) => {

    console.log(m.stack);
  } );
}
//$lab:coverage:on$

module.exports.db = db;
module.exports.server = server.register([{
  register: require('inert')
}, {
  register: require('vision')
}, {
  register: require('hapi-swagger'),
  options: {
    grouping: 'tags',
    info: {
      title: Pkg.description,
      version: Pkg.version,
      contact: Pkg.author,
      license: {
        name: Pkg.license,
        url: 'https://api.lift.zone/license'//This one is ok to hard code imo
      }
    }
  }
}, {
  register: require('good'),
  options: Config.good
}, {
  register: require('hapi-rate-limit'),
  options: Config.rateLimit
}, {
  register: require('drboom'),
  options: {
    plugins: [
      require('drboom-joi')({ Boom: require('boom') }),
      require('drboom-pg')({})
    ]
  }
}, {
  register: require('hapi-auth-jwt2')
}, {
  register: require('hapi-pagination'),
  options: Config.pagination
}]).then(() => {

  server.bind({
    db,
    utils: Utils
  });

  server.auth.strategy('jwt', 'jwt', true, {
    key: Config.auth.secret,
    verifyOptions: {
      algorithms: [Config.auth.options.algorithm]
    },
    validateFunc: (decoded, request, callback) => {

      db.users.active(decoded.email).then((user) => {

        if (!user) {
          return callback(null, false);
        }

        if (Date.parse(decoded.timestamp) < user.logout.getTime()) {

          return callback(null, false);
        }

        delete user.hash;
        return callback(null, true, user);
      }).catch(callback);
    }
  });

  server.route(require('./routes'));
}).then(() => {

  // coverage disabled because module.parent is always defined in tests
  // $lab:coverage:off$
  if (module.parent) {
    return server.initialize().then(() => {

      return server;
    });
  }

  return server.start().then(() => {

    server.connections.forEach((connection) => {

      server.log(['info', 'startup'], `${connection.info.uri} ${connection.settings.labels}`);
    });
  });
  // $lab:coverage:on$
}).catch((err) => {

  // coverage disabled due to difficulty in faking a throw
  // $lab:coverage:off$
  console.error(err.stack || err);
  process.exit(1);
  // $lab:coverage:on$
});
