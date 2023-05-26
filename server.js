if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

const express = require('express')
const ParseServer = require('parse-server').ParseServer
const ParseDashboard = require('parse-dashboard')
const S3Adapter = require('@parse/s3-files-adapter')
const FSFilesAdapter = require('@parse/fs-files-adapter')
const OneSignalPushAdapter = require('@fmendoza/parse-server-onesignal-push-adapter')
const expressLayouts = require('express-ejs-layouts')
const cookieParser = require('cookie-parser')
const methodOverride = require('method-override')
const cookieSession = require('cookie-session')
const i18n = require('i18n')
const AWS = require('aws-sdk')

i18n.configure({
  locales: ['en', 'es', 'ar'],
  defaultLocale: 'en',
  fallbacks: { 'en': 'en' },
  directory: __dirname + '/locales',
  register: global
})

const customLang = process.env.CUSTOM_LANG || 'en'
i18n.setLocale(customLang)

const configParseServer = {
  filesAdapter: null,
  emailAdapter: null,
  databaseOptions: {},
  push: {},
  auth: {},
}

// Default storage (Filesystem)
let filesAdapter = new FSFilesAdapter()
configParseServer.filesAdapter = filesAdapter

// AWS S3 config (optional)
const bucketName = process.env.AWS_BUCKET_NAME
const accessKeyId = process.env.AWS_ACCESS_KEY_ID
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

if (accessKeyId && secretAccessKey && bucketName) {
  filesAdapter = new S3Adapter(bucketName, {
    directAccess: true
  })

  configParseServer.filesAdapter = filesAdapter
}

// DigitalOcean Spaces config (optional)
const spacesEndpoint = process.env.SPACES_ENDPOINT
const spacesBucketName = process.env.SPACES_BUCKET_NAME
const spacesBaseUrl = process.env.SPACES_BASE_URL
const spacesRegion = process.env.SPACES_REGION
const spacesAccessKey = process.env.SPACES_ACCESS_KEY
const spacesSecretKey = process.env.SPACES_SECRET_KEY

if (
  spacesEndpoint &&
  spacesBucketName &&
  spacesBaseUrl &&
  spacesRegion &&
  spacesAccessKey &&
  spacesSecretKey
) {

  const endpoint = new AWS.Endpoint(spacesEndpoint)

  filesAdapter = new S3Adapter({
    bucket: spacesBucketName,
    baseUrl: spacesBaseUrl,
    region: spacesRegion,
    directAccess: true,
    bucketPrefix: '',
    globalCacheControl: 'public, max-age=86400',
    s3overrides: {
      accessKeyId: spacesAccessKey,
      secretAccessKey: spacesSecretKey,
      endpoint: endpoint,
    }
  })

  configParseServer.filesAdapter = filesAdapter
}

const googleClientId = process.env.GOOGLE_CLIENT_ID

if (googleClientId) {
  configParseServer.auth.google = {
    clientId: googleClientId
  }
}

const pushSenderId = process.env.PUSH_ANDROID_SENDER_ID
const pushApiKey = process.env.PUSH_ANDROID_API_KEY

if (pushSenderId && pushApiKey) {
  configParseServer.push.android = {
    senderId: pushSenderId,
    apiKey: pushApiKey,
  }
}

const pushIosBundleId = process.env.PUSH_IOS_BUNDLE_ID

if (pushIosBundleId) {
  configParseServer.push.ios = [{
    pfx: __dirname + '/push/dev.p12',
    topic: pushIosBundleId,
    production: false
  },
  {
    pfx: __dirname + '/push/prod.p12',
    topic: pushIosBundleId,
    production: true
  }]
}

const oneSignalAppId = process.env.ONE_SIGNAL_APP_ID
const oneSignalApiKey = process.env.ONE_SIGNAL_API_KEY

if (oneSignalAppId && oneSignalApiKey) {
  const oneSignalPushAdapter = new OneSignalPushAdapter({
    oneSignalAppId: oneSignalAppId,
    oneSignalApiKey: oneSignalApiKey
  })
  configParseServer.push.adapter = oneSignalPushAdapter
}

const mailgunDomain = process.env.MAILGUN_DOMAIN
const mailgunHost = process.env.MAILGUN_HOST
const mailgunApiKey = process.env.MAILGUN_API_KEY
const mailgunFromAddress = process.env.MAILGUN_FROM_ADDRESS

if (mailgunDomain &&
  mailgunHost &&
  mailgunApiKey &&
  mailgunFromAddress) {

  emailAdapter = {
    module: 'parse-server-mailgun-adapter-template',
    options: {
      fromAddress: mailgunFromAddress,
      domain: mailgunDomain,
      apiKey: mailgunApiKey,
      host: mailgunHost,
      // Verification email subject
      verificationSubject: __('VERIFICATION_SUBJECT'),
      // Verification email body
      verificationBody: __('VERIFICATION_BODY'),
      passwordResetSubject: __('PASSWORD_RESET_SUBJECT'),
      // Password reset email body
      passwordResetBody: __('PASSWORD_RESET_BODY'),
    }
  }

  configParseServer.emailAdapter = emailAdapter

  const verifyEmails = process.env.VERIFY_USER_EMAILS
  configParseServer.verifyUserEmails = verifyEmails === '1' ? true : false
  configParseServer.preventLoginWithUnverifiedEmail = false
  // in seconds (2 hours = 7200 seconds)
  configParseServer.emailVerifyTokenValidityDuration = 2 * 60 * 60
}

const app = express()

app.set('view engine', 'ejs')
app.set('views', 'views')

app.use(express.urlencoded({
  limit: process.env.MAX_REQUEST_SIZE || '20mb',
  extended: true
}))

// Use JSON parser for all non-webhook routes
app.use((req, res, next) => {
  if (req.originalUrl === '/stripe/webhook') {
    next()
  } else {
    express.json({
      limit: process.env.MAX_REQUEST_SIZE || '20mb',
      extended: true,
    })(req, res, next)
  }
})

app.use(express.static(__dirname + '/public'))
app.use(expressLayouts)
app.use(cookieParser())
app.use(methodOverride())

app.use(cookieSession({
  name: process.env.APP_ID + '.sess',
  secret: process.env.MASTER_KEY,
  maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
}))

const databaseUri = process.env.DATABASE_URL || process.env.MONGO_URL
const dbPathCertificate = process.env.DB_PATH_CERTIFICATE

if (dbPathCertificate) {
  configParseServer.databaseOptions.tls = true
  configParseServer.databaseOptions.tlsCAFile = dbPathCertificate
}

if (databaseUri) {

  // Parse Server Configuration
  // https://github.com/parse-community/parse-server#configuration

  const api = new ParseServer({
    ...configParseServer,
    databaseURI: databaseUri,
    cloud: __dirname + '/cloud/main.js',
    appId: process.env.APP_ID,
    masterKey: process.env.MASTER_KEY,
    readOnlyMasterKey: process.env.READ_ONLY_MASTER_KEY,
    serverURL: `http://localhost:${process.env.PORT}/api`,
    directAccess: true,
    fileUpload: {
      enableForPublic: true,
      enableForAnonymousUser: true,
      enableForAuthenticatedUser: true,
    },
    enforcePrivateUsers: false,
    allowClientClassCreation: false,
    expireInactiveSessions: false,
    publicServerURL: process.env.PUBLIC_SERVER_URL + '/api',
    logLevel: process.env.LOG_LEVEL || 'error',
    appName: process.env.APP_NAME,
    maxUploadSize: process.env.MAX_REQUEST_SIZE || '20mb',
    customPages: {
      verifyEmailSuccess: process.env.PUBLIC_SERVER_URL + '/custom/verifyEmailSuccess',
      passwordResetSuccess: process.env.PUBLIC_SERVER_URL + '/custom/passwordResetSuccess',
      invalidLink: process.env.PUBLIC_SERVER_URL + '/custom/invalidLink',
      invalidVerificationLink: process.env.PUBLIC_SERVER_URL + '/custom/invalidLink',
      choosePassword: process.env.PUBLIC_SERVER_URL + '/custom/choosePassword'
    },
  })

  // Serve the Parse API
  app.use('/api', api)

  // Parse Dashboard
  // https://github.com/parse-community/parse-dashboard

  const dashboard = new ParseDashboard({
    apps: [
      {
        serverURL: process.env.PUBLIC_SERVER_URL + '/api',
        appId: process.env.APP_ID,
        masterKey: process.env.MASTER_KEY,
        readOnlyMasterKey: process.env.READ_ONLY_MASTER_KEY,
        appName: process.env.APP_NAME,
        production: true,
      }
    ],
    users: [
      {
        user: process.env.PARSE_DASHBOARD_USER_READ_ONLY,
        pass: process.env.PARSE_DASHBOARD_PASS_READ_ONLY,
        readOnly: true,
      },
      {
        user: process.env.PARSE_DASHBOARD_USER,
        pass: process.env.PARSE_DASHBOARD_PASS
      },
    ],
    useEncryptedPasswords: true,
    trustProxy: 1
  }, {
    allowInsecureHTTP: true,
    cookieSessionSecret: process.env.MASTER_KEY
  });

  // Serve the Parse Dashboard on the /dashboard URL prefix
  app.use('/dashboard', dashboard);
}

// Cache public files
app.get('/*', (req, res, next) => {
  if (req.url.includes('/files/') && req.method == 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=300') // 5 minutes
    res.setHeader('Expires', new Date(Date.now() + 300).toUTCString())
  }
  next()
})

app.use(require('./controllers'))

// Cron job to expire places every minute.
require('./jobs/expire-places');

const httpServer = require('http').createServer(app)
httpServer.listen(process.env.PORT, () => {
  console.log(process.env.APP_NAME + ' running on port ' + process.env.PORT + '.')
})