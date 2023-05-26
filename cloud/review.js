const Utils = require('../utils')

Parse.Cloud.beforeFind('Review', async (req) => {
  const { master, query, user } = req

  if ((!user && !master) || (user && user.get('type') === 'customer')) {
    query.equalTo('status', 'Published')
  }
})

Parse.Cloud.beforeSave('Review', async (req) => {

  const obj = req.object
  const attrs = obj.attributes
  const user = req.user

  if (!user && !req.master) throw 'Not Authorized'

  if (!obj.existed()) {
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(true)
    acl.setRoleWriteAccess('Admin', true)
    acl.setWriteAccess(user, true)
    obj.setACL(acl)
    obj.set('user', user)

    const queryConfig = new Parse.Query('AppConfig')

    const config = await queryConfig.first({
      useMasterKey: true
    })

    let status = 'Pending'
    let isMultipleReviewEnabled = false

    if (config) {

      const reviewConfig = config.get('reviews')

      if (reviewConfig && reviewConfig.disabled) {
        throw new Parse.Error(5003, 'Reviews disabled')
      }

      if (reviewConfig && reviewConfig.autoApprove) {
        status = 'Published'
      }

      if (reviewConfig && reviewConfig.multiplePerUser) {
        isMultipleReviewEnabled = true
      }

    }

    obj.set('status', status)

    if (!isMultipleReviewEnabled) {

      const query = new Parse.Query('Review')
      query.equalTo('user', user)
      query.equalTo('place', attrs.place)

      const exists = await query.first()

      if (exists) {
        throw new Parse.Error(5000, 'You already write a review for this place')
      }

    }

  }

  if (obj.get('rating') < 1) {
    throw new Parse.Error(5001, 'You cannot give less than one star')
  } else if (obj.get('rating') > 5) {
    throw new Parse.Error(5002, 'You cannot give more than five stars')
  }

})

Parse.Cloud.afterSave('Review', async (req) => {

  const obj = req.object
  const attrs = obj.attributes
  const original = req.original
  const origAttrs = original ? original.attributes : {}

  try {

    if ((!obj.existed() && attrs.status === 'Published') ||
      (obj.existed() && attrs.status !== origAttrs.status)) {

      const place = attrs.place

      await place.fetch()

      if (attrs.status === 'Published') {

        place.increment('ratingCount')
        place.increment('ratingTotal', attrs.rating)

      } else if (origAttrs.status === 'Published' &&
        (attrs.status === 'Pending' || attrs.status === 'Banned')) {

        place.increment('ratingCount', -1)
        place.increment('ratingTotal', -attrs.rating)

      }

      if (place.dirty()) {

        const ratingTotal = place.get('ratingTotal')
        const ratingCount = place.get('ratingCount')

        if (ratingTotal && ratingCount) {
          const ratingAvg = Math.round(ratingTotal / ratingCount)
          place.set('ratingAvg', ratingAvg)
        } else {
          place.set('ratingAvg', 0)
        }

        place.save(null, { useMasterKey: true })
      }

    }

  } catch (err) {
    console.warn(err.message)
  }
})

Parse.Cloud.afterDelete('Review', async (req) => {

  const obj = req.object
  const attrs = obj.attributes

  if (attrs.status === 'Published') {
    const place = attrs.place

    await place.fetch()

    place.increment('ratingCount', -1)
    place.increment('ratingTotal', -attrs.rating)

    const ratingAvg = Math.round(place.get('ratingTotal') / place.get('ratingCount'))
    place.set('ratingAvg', ratingAvg)

    place.save(null, { useMasterKey: true })
  }

})

Parse.Cloud.job('addReviewStatus', async (req) => {

  const { message } = req

  message(`Job started at ${new Date().toISOString()}`)

  try {

    const query = new Parse.Query('Review')

    await query.each(review => {
      const isInappropriate = review.get('isInappropriate')

      if (!isInappropriate) {
        review.set('status', 'Published')
      } else {
        review.set('status', 'Pending')
      }

      if (review.dirty()) {
        return review.save(null, { useMasterKey: true })
      }

    }, { useMasterKey: true })

    message(`Job finished at ${new Date().toISOString()}`)

  } catch (error) {
    message(error.message)
  }

})

Parse.Cloud.define('getReviewsWithUser', async (req) => {

  const { master, params, user, } = req

  if (!user && !master) throw 'Not Authorized'

  if (user) {
    const isAdmin = await Utils.isAdmin(user)
    if (!isAdmin) throw 'Not Authorized'
  }

  const query = new Parse.Query('Review')

  if (params.user) {
    query.equalTo('user', params.user)
  }

  if (params.status) {
    query.equalTo('status', params.status)
  }

  if (params.place) {
    query.equalTo('place', params.place)
  }

  if (params.rating) {
    query.equalTo('rating', params.rating)
  }

  if (params.limit) {
    query.limit(params.limit)
  }

  if (params.limit && params.page) {
    const skip = params.limit * (params.page - 1)
    query.skip(skip)
  }

  query.descending('createdAt')

  if (params.sort && params.sort.direction === 'asc') {
    query.ascending(params.sort.field)
  } else if (params.sort && params.sort.direction === 'desc') {
    query.descending(params.sort.field)
  }

  query.withCount()
  query.include(['place', 'user'])
  query.doesNotExist('deletedAt')

  return query.find({ useMasterKey: true })

})

Parse.Cloud.define('getReviewWithUser', async (req) => {

  const { master, params, user, } = req

  if (!user && !master) throw 'Not Authorized'

  if (user) {
    const isAdmin = await Utils.isAdmin(user)
    if (!isAdmin) throw 'Not Authorized'
  }

  const query = new Parse.Query('Review')

  query.include(['place', 'user'])
  query.doesNotExist('deletedAt')

  return query.get(params.id, { useMasterKey: true })

})