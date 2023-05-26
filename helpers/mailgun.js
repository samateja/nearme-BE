const formData = require('form-data')
const Mailgun = require('mailgun.js')

let mailgun = null
let domain = null

var MailgunHelper = function (options) {

  domain = options.domain

  const mailgunInstance = new Mailgun(formData)
  mailgun = mailgunInstance.client({
    username: 'api',
    key: options.apiKey,
    url: `https://${options.host}`,
  })
}

MailgunHelper.prototype.send = (params) => {

  const data = {
    from: params.from,
    to: params.to,
    html: params.html,
    subject: params.subject,
  }

  return mailgun.messages.create(domain, data)
}

module.exports.MailgunHelper = MailgunHelper
