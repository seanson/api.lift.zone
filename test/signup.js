process.env.NODE_ENV = 'test';

var Code = require('code');
var Hoek = require('hoek');
var Lab = require('lab');
var Nodemailer = require('nodemailer');

var Fixtures = require('./fixtures');
var DbHelper = require('./db-helper');
var AuthInject = require('./auth-inject');
var serverItems = require('../').getServer();

var lab = exports.lab = Lab.script();

var server = serverItems.server;
var utils = serverItems.utils;
var dbHelper = new DbHelper(serverItems.db);

var mailLog = {};
var sendMail = function (options, callback) {

    if (!mailLog[options.to]) {
        mailLog[options.to] = [];
    }

    mailLog[options.to].push(options);

    if (callback) {
        return callback();
    }
};

//server.on('request-error', function (request, error) {

    //console.log(error.stack);
//});

lab.experiment('signup and validate', function () {

    var authUser;
    var userAuthHeader;
    var inviteCode;
    var validateCode;

    lab.before(function (done) {

        Nodemailer.createTransport = function () {

            return { sendMail: sendMail };
        };

        return dbHelper.rollbackAll().then(function () {

            return dbHelper.migrateLatest();
        }).then(function () {

            return dbHelper.createUser(Fixtures.users.main, { count: 5 });
        }).then(function () {

            server.start(function () {

                var options = {
                    method: 'POST', url: '/api/v1/login',
                    headers: {
                        accept: 'application/vnd.api+json',
                        'content-type': 'application/vnd.api+json'
                    },
                    payload: {
                        data: {
                            type: 'login',
                            attributes: {
                                login: Fixtures.users.main.login,
                                password: Fixtures.users.main.password
                            }
                        }
                    }
                };
                return server.inject(options, function (response) {

                    var payload = JSON.parse(response.payload);
                    Code.expect(response.statusCode).to.equal(201);
                    Code.expect(payload.data).to.include('id', 'type', 'attributes');
                    Code.expect(payload.data.type).to.equal('authToken');
                    userAuthHeader = {
                        authorization: 'Bearer ' + payload.data.attributes.token
                    };

                    return done();
                });
            });
        });
    });

    lab.test('get invites', function (done) {

        var options = {
            method: 'GET', url: '/api/v1/me/invites'
        };
        AuthInject(server, options, userAuthHeader, function (response) {

            var payload = JSON.parse(response.payload);
            Code.expect(response.statusCode).to.equal(200);
            Code.expect(payload.data).to.have.length(5);
            inviteCode = payload.data[0];
            done();
        });
    });

    lab.experiment('signup using invite', function () {

        var signupUser;
        var signupUserAuthHeader;

        lab.experiment('invite validity', function () {

            lab.test('valid invite', function (done) {

                var options = {
                    method: 'GET', url: '/api/v1/invite/' + inviteCode.attributes.code,
                    headers: {
                        accept: 'application/vnd.api+json',
                        'content-type': 'application/vnd.api+json'
                    }
                };
                server.inject(options, function (response) {

                    Code.expect(response.statusCode).to.equal(200);
                    done();
                });
            });

            lab.test('invalid invite', function (done) {

                var options = {
                    method: 'GET', url: '/api/v1/invite/' + utils.generateInviteCode(),
                    headers: {
                        accept: 'application/vnd.api+json',
                        'content-type': 'application/vnd.api+json'
                    }
                };
                server.inject(options, function (response) {

                    Code.expect(response.statusCode).to.equal(404);
                    done();
                });
            });
        });
        lab.experiment('login availability', function () {

            lab.test('invalid invite', function (done) {

                var options = {
                    method: 'POST', url: '/api/v1/taken',
                    headers: {
                        accept: 'application/vnd.api+json',
                        'content-type': 'application/vnd.api+json'
                    },
                    payload: {
                        data: {
                            type: 'taken',
                            id: 'taken',
                            attributes: {
                                invite: utils.generateInviteCode(),
                                login: Fixtures.users.main.login
                            }
                        }
                    }
                };
                server.inject(options, function (response) {

                    Code.expect(response.statusCode).to.equal(404);
                    done();
                });
            });

            lab.test('login taken', function (done) {

                var options = {
                    method: 'POST', url: '/api/v1/taken',
                    headers: {
                        accept: 'application/vnd.api+json',
                        'content-type': 'application/vnd.api+json'
                    },
                    payload: {
                        data: {
                            type: 'taken',
                            id: 'taken',
                            attributes: {
                                invite: inviteCode.attributes.code,
                                login: Fixtures.users.main.login
                            }
                        }
                    }
                };
                server.inject(options, function (response) {

                    var payload = JSON.parse(response.payload);
                    Code.expect(response.statusCode).to.equal(200);
                    Code.expect(payload.data).to.include('id', 'type', 'attributes');
                    Code.expect(payload.data.type).to.equal('taken');
                    Code.expect(payload.data.attributes.taken).to.equal(true);
                    done();
                });
            });

            lab.test('login available', function (done) {

                var options = {
                    method: 'POST', url: '/api/v1/taken',
                    headers: {
                        accept: 'application/vnd.api+json',
                        'content-type': 'application/vnd.api+json'
                    },
                    payload: {
                        data: {
                            type: 'taken',
                            id: 'taken',
                            attributes: {
                                invite: inviteCode.attributes.code,
                                login: Fixtures.users.nonexistant.login
                            }
                        }
                    }
                };
                server.inject(options, function (response) {

                    var payload = JSON.parse(response.payload);
                    Code.expect(response.statusCode).to.equal(200);
                    Code.expect(payload.data).to.include('id', 'type', 'attributes');
                    Code.expect(payload.data.type).to.equal('taken');
                    Code.expect(payload.data.attributes.taken).to.equal(false);
                    done();
                });
            });
        });

        lab.test('sign up login taken', function (done) {

            var invite = Hoek.applyToDefaults(Fixtures.users.signup, { invite: inviteCode.attributes.code, passwordConfirm: Fixtures.users.signup.password });
            invite.login = Fixtures.users.main.login;

            var options = {
                method: 'POST', url: '/api/v1/signup',
                headers: {
                    accept: 'application/vnd.api+json',
                    'content-type': 'application/vnd.api+json'
                },
                payload: {
                    data: {
                        type: 'signup',
                        attributes: invite
                    }
                }
            };
            server.inject(options, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(409);
                done();
            });
        });

        lab.test('sign up', function (done) {

            var invite = Hoek.applyToDefaults(Fixtures.users.signup, { invite: inviteCode.attributes.code, passwordConfirm: Fixtures.users.signup.password });
            var options = {
                method: 'POST', url: '/api/v1/signup',
                headers: {
                    accept: 'application/vnd.api+json',
                    'content-type': 'application/vnd.api+json'
                },
                payload: {
                    data: {
                        type: 'signup',
                        attributes: invite
                    }
                }
            };
            server.inject(options, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(201);
                Code.expect(payload.data).to.include('id', 'type', 'attributes');
                Code.expect(payload.data.type).to.equal('authToken');
                signupUserAuthHeader = {
                    authorization: 'Bearer ' + payload.data.attributes.token
                };
                done();
            });
        });

        lab.test('invite got used', function (done) {

            var options = {
                method: 'GET', url: '/api/v1/me/invites'
            };
            AuthInject(server, options, userAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(200);
                Code.expect(payload.data).to.have.length(4);
                done();
            });
        });

        lab.test('reuse signup token', function (done) {

            var invite = Hoek.applyToDefaults(Fixtures.users.signup, { invite: inviteCode.attributes.code, passwordConfirm: Fixtures.users.signup.password });
            var options = {
                method: 'POST', url: '/api/v1/signup',
                headers: {
                    accept: 'application/vnd.api+json',
                    'content-type': 'application/vnd.api+json'
                },
                payload: {
                    data: {
                        type: 'signup',
                        attributes: invite
                    }
                }
            };
            server.inject(options, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(404);
                done();
            });
        });

        lab.test('signup user not validated', function (done) {

            var options = {
                method: 'GET', url: '/api/v1/me'
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(200);
                Code.expect(payload.data).to.include('id', 'type', 'attributes');
                Code.expect(payload.data.attributes.validated).to.equal(false);
                done();
            });
        });

        lab.test('no invites for non validated user', function (done) {

            var options = {
                method: 'GET', url: '/api/v1/me/invites'
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(404);
                Code.expect(payload.data).to.equal(undefined);
                done();
            });
        });

        lab.test('nonexistant validation confirm validation', function (done) {

            var options = {
                'method': 'POST', url: '/api/v1/me/confirm',
                payload: {
                    data: {
                        id: utils.generateValidationCode(),
                        type: 'validation'
                    }
                }
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                Code.expect(response.statusCode).to.equal(404);
                done();
            });
        });

        lab.test('request validation', function (done) {

            var options = {
                method: 'POST', url: '/api/v1/validate'
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(202);
                Code.expect(payload.data).to.equal(null);
                Code.expect(mailLog[Fixtures.users.signup.email]).to.have.length(1);
                validateCode = mailLog[Fixtures.users.signup.email][0].text.split('code=')[1];
                done();
            });
        });

        lab.test('re-request validation', function (done) {

            var options = {
                method: 'POST', url: '/api/v1/validate'
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(202);
                Code.expect(payload.data).to.equal(null);
                Code.expect(mailLog[Fixtures.users.signup.email]).to.have.length(1);
                done();
            });
        });

        lab.test('invalid confirm validation', function (done) {

            var options = {
                'method': 'POST', url: '/api/v1/me/confirm',
                payload: {
                    data: {
                        id: utils.generateValidationCode(),
                        type: 'validation'
                    }
                }
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                Code.expect(response.statusCode).to.equal(404);
                done();
            });
        });

        lab.test('confirm validation', function (done) {

            var options = {
                'method': 'POST', url: '/api/v1/me/confirm',
                payload: {
                    data: {
                        id: validateCode,
                        type: 'validation'
                    }
                }
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(200);
                Code.expect(payload.data).to.equal(null);
                done();
            });

        });

        lab.test('re-confirm validation', function (done) {

            var options = {
                'method': 'POST', url: '/api/v1/me/confirm',
                payload: {
                    data: {
                        id: validateCode,
                        type: 'validation'
                    }
                }
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(200);
                Code.expect(payload.data).to.equal(null);
                done();
            });

        });

        lab.test('user is validated', function (done) {

            var options = {
                method: 'GET', url: '/api/v1/me'
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(200);
                Code.expect(payload.data).to.include('id', 'type', 'attributes');
                Code.expect(payload.data.attributes.validated).to.equal(true);
                done();
            });
        });

        lab.test('request superfluous validation', function (done) {

            var options = {
                method: 'POST', url: '/api/v1/validate'
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(202);
                Code.expect(payload.data).to.equal(null);
                Code.expect(mailLog[Fixtures.users.signup.email]).to.have.length(1);
                done();
            });
        });

        lab.test('validated user has invites', function (done) {

            var options = {
                method: 'GET', url: '/api/v1/me/invites'
            };
            AuthInject(server, options, signupUserAuthHeader, function (response) {

                var payload = JSON.parse(response.payload);
                Code.expect(response.statusCode).to.equal(200);
                Code.expect(payload.data).to.have.length(5);
                inviteCode = payload.data[0];
                done();
            });
        });
    });
});
