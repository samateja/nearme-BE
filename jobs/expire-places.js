const cron = require('node-cron')
const moment = require('moment')

// Run every hour
cron.schedule('0 * * * *', async () => {

  try {

    const queryUser = new Parse.Query(Parse.User)
    queryUser.equalTo('type', 'super_admin')
    const superAdmin = await queryUser.first({ useMasterKey: true })

    if (!superAdmin) {
      return
    }

    console.log('Running expire places job', new Date().toISOString())

    const query = new Parse.Query('Place')
    query.notEqualTo('status', 'Expired')
    query.exists('expiresAt')
    query.lessThanOrEqualTo('expiresAt', moment.utc().toDate())

    const places = await query.find()

    places.forEach(place => place.set('status', 'Expired'))

    await Parse.Object.saveAll(places, {
      useMasterKey: true
    })

  } catch (err) {
    console.log(err.message)
  }

  try {

    const query = new Parse.Query('Place')
    query.equalTo('status', 'Approved')
    query.equalTo('isFeatured', true)
    query.exists('featuredExpiresAt')
    query.lessThanOrEqualTo('featuredExpiresAt', moment.utc().toDate())

    const places = await query.find()

    places.forEach(place => {
      place.set('isFeatured', false)
    })

    await Parse.Object.saveAll(places, {
      useMasterKey: true
    })

  } catch (err) {
    console.log(err.message)
  }

})