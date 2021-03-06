'use strict';

const Joi = require('joi');

module.exports = {
  description: 'Invites for currently logged in user',
  tags: ['api', 'user'],
  handler: function (request, reply) {

    if (!request.auth.credentials.validated) {
      return reply([]);
    }

    const result = this.db.invites.find({ user_id: request.auth.credentials.id, claimed_by: null });

    return reply(result);
  },
  response: {
    modify: true,
    schema: Joi.array().items(Joi.object({
      claimed_by: Joi.any().strip(),
      user_id: Joi.any().strip()
    }).unknown())
  }
};
