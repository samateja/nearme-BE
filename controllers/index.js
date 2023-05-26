const express = require('express')
const install = require('../middlewares/install')

const router = express.Router()

router.use('/install', require('./install'))
router.use('/custom', require('./custom'))
router.use('/stripe', require('./stripe'))

router.get('/', install, (req, res) => {
  res.redirect('/dashboard')
})

module.exports = router