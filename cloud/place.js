const sharp = require('sharp')
const slug = require('limax')
const Place = require('../models/place')
const MailgunHelper = require('../helpers/mailgun').MailgunHelper
const Mailgen = require('mailgen')
const moment = require('moment')
const axios = require('axios')
const Utils = require('../utils')

Parse.Cloud.define('createPlace', async (req) => {

  const { user, params } = req

  if (!user) throw 'Not Authorized'

  let userPackage = null

  const queryConfig = new Parse.Query('AppConfig')

  const config = await queryConfig.first({
    useMasterKey: true
  })

  if (config) {

    const placeConfig = config.get('places')

    if (placeConfig && placeConfig.enablePaidListings) {

      const queryPackage = new Parse.Query('Package')
      queryPackage.equalTo('objectId', params.packageId)
      queryPackage.doesNotExist('deletedAt')
      const fetchedPackage = await queryPackage.first({ useMasterKey: true })

      const queryUserPackage = new Parse.Query('UserPackage')
      queryUserPackage.equalTo('objectId', params.packageId)
      queryUserPackage.doesNotExist('deletedAt')
      const fetchedUserPackage = await queryUserPackage.first({
        useMasterKey: true
      })

      if (fetchedPackage) {

        // Verify multiple purchases

        if (fetchedPackage.get('disableMultiplePurchases')) {

          const queryUserPackageCount = new Parse.Query('UserPackage')
          queryUserPackageCount.equalTo('package.objectId', fetchedPackage.id)
          queryUserPackageCount.equalTo('user', user)
          queryUserPackageCount.doesNotExist('deletedAt')
          const count = await queryUserPackageCount.count({
            useMasterKey: true
          })

          if (count) {
            throw new Parse.Error(5000, 'Cannot purchase this package multiple times')
          }
        }

        userPackage = new Parse.Object('UserPackage')
        userPackage.set('user', user)
        userPackage.set('package', fetchedPackage.toJSON())
        await userPackage.save(null, { useMasterKey: true })

      } else if (fetchedUserPackage) {

        userPackage = fetchedUserPackage

        // check limit usage


        if (userPackage.get('isLimitReached')) {
          throw new Parse.Error(5001, 'Usage limit reached')
        }

        if (userPackage.get('status') === 'unpaid') {
          throw new Parse.Error(5002, 'Unpaid package')
        }

        userPackage.increment('usage', 1)

        await userPackage.save(null, {
          useMasterKey: true
        })

      } else {
        throw 'Package not found'
      }

    }

  }

  const categories = params.categories.map(category => {
    const obj = new Parse.Object('Category')
    obj.id = category;
    return obj;
  })

  const place = new Parse.Object('Place')
  place.set('title', params.title)
  place.set('categories', categories)
  place.set('description', params.description)

  const location = new Parse.GeoPoint(
    params.location.lat,
    params.location.lng,
  )
  place.set('location', location)

  place.set('address', params.address)
  place.set('image', params.image)
  place.set('images', params.images)
  place.set('website', params.website)
  place.set('phone', params.phone)
  place.set('email', params.email)
  place.set('priceRange', params.priceRange)
  place.set('facebook', params.facebook)
  place.set('instagram', params.instagram)
  place.set('youtube', params.youtube)
  place.set('whatsapp', params.whatsapp)
  place.set('userPackage', userPackage)
  place.set('user', user)

  if (config) {

    const placeConfig = config.get('places')

    if (placeConfig &&
      placeConfig.autoApprove &&
      !placeConfig.enablePaidListings) {
      place.set('status', 'Approved')
    }
  }

  if (userPackage) {

    const package = userPackage.get('package')

    if (userPackage.get('status') === 'paid') {

      if (package.autoApproveListing) {
        place.set('status', 'Approved')
      }

      if (package.markListingAsFeatured) {
        place.set('isFeatured', true)
      }

      if (package.listingDuration) {

        const expiresAt = moment()
          .add(package.listingDuration, 'days')
          .startOf('day')
          .toDate()

        place.set('expiresAt', expiresAt)
      }
    }

  }

  await place.save(null, {
    useMasterKey: true
  })

  return { place, userPackage }
})

Parse.Cloud.define('updatePlace', async (req) => {

  const { user, params } = req

  if (!user) throw 'Not Authorized'

  const place = new Parse.Object('Place')
  place.id = params.id
  await place.fetch()

  if (user.id !== place.get('user').id) {
    return 'Invalid user'
  }

  const categories = params.data.categories.map(category => {
    const obj = new Parse.Object('Category')
    obj.id = category;
    return obj;
  })

  place.set('title', params.data.title)
  place.set('categories', categories)
  place.set('description', params.data.description)

  const location = new Parse.GeoPoint(
    params.data.location.lat,
    params.data.location.lng,
  )
  place.set('location', location)

  place.set('address', params.data.address)
  place.set('image', params.data.image)
  place.set('images', params.data.images)
  place.set('website', params.data.website)
  place.set('phone', params.data.phone)
  place.set('email', params.data.email)
  place.set('priceRange', params.data.priceRange)
  place.set('facebook', params.data.facebook)
  place.set('instagram', params.data.instagram)
  place.set('whatsapp', params.data.whatsapp)
  place.set('youtube', params.data.youtube)
  place.set('status', 'Pending Approval')

  const queryConfig = new Parse.Query('AppConfig')

  const config = await queryConfig.first({
    useMasterKey: true
  })

  if (config) {

    const placeConfig = config.get('places')

    if (placeConfig && placeConfig.autoApprove) {
      place.set('status', 'Approved')
    }
  }

  return place.save(null, {
    useMasterKey: true
  })

})

Parse.Cloud.define('deletePlace', async (req) => {

  const { user, params } = req

  if (!user) throw 'Not Authorized'

  const place = new Parse.Object('Place')
  place.id = params.id
  await place.fetch()

  if (user.id !== place.get('user').id) {
    return 'Invalid user'
  }

  return place.destroy({
    useMasterKey: true
  })

})

Parse.Cloud.define('getRandomPlaces', async (req) => {

  const { latitude, longitude, unit } = req.params

  if ((!latitude || !longitude || !unit)) {
    throw 'Missing params'
  }

  const queryAppConfig = new Parse.Query('AppConfig')
  const appConfig = await queryAppConfig.first({
    useMasterKey: true
  })

  let searchRadius = 0

  if (appConfig) {
    const placeSettings = appConfig.get('places')

    if (placeSettings) {
      searchRadius = placeSettings.searchRadius
    }
  }

  const pipeline = []

  if (searchRadius) {
    pipeline.push({
      geoNear: {
        near: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        maxDistance: searchRadius,
        key: 'location',
        spherical: true,
        distanceField: 'dist',
        query: {
          status: 'Approved',
        }
      }
    })

    pipeline.push({
      sample: {
        size: 15
      }
    })

  } else {

    pipeline.push({
      match: {
        status: 'Approved',
      },
    })

    pipeline.push({
      sample: {
        size: 15
      }
    })
  }



  const query = new Parse.Query('Place')

  const results = await query.aggregate(pipeline)

  const ids = results.map(result => result.objectId)

  const query1 = new Parse.Query('Place')
  query1.containedIn('objectId', ids)
  query1.include('categories')


  return await query1.find()

})

Parse.Cloud.define('getPlaces', async (req) => {

  const { params } = req

  const page = params.page || 0
  const limit = params.limit || 100
  const status = params.status || 'Approved'
  const maxDistance = params.maxDistance

  const queryAppConfig = new Parse.Query('AppConfig')
  const appConfig = await queryAppConfig.first({
    useMasterKey: true
  })

  let searchRadius = 0

  if (appConfig) {
    const placeSettings = appConfig.get('places')

    if (placeSettings) {
      searchRadius = placeSettings.searchRadius
    }

    if (maxDistance && maxDistance <= searchRadius) {
      searchRadius = maxDistance
    }
  }

  const queries = []

  if (params.tag) {

    const searchQuery = params.tag.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')

    const queryTag = new Parse.Query('Place')
    queryTag.contains('tags', searchQuery)
    queries.push(queryTag)

    const queryCanonical = new Parse.Query('Place')
    queryCanonical.contains('canonical', searchQuery)
    queries.push(queryCanonical)
  }

  let query = new Parse.Query('Place')

  if (queries.length) {
    query = Parse.Query.or(...queries)
  }

  if (Array.isArray(status)) {
    query.containedIn('status', status)
  } else {
    query.equalTo('status', status)
  }

  if (params.ratingMin) {
    query.greaterThanOrEqualTo('ratingAvg', Number(params.ratingMin))
  }

  if (params.ratingMax) {
    query.lessThanOrEqualTo('ratingAvg', Number(params.ratingMax))
  }

  if (params.cat) {

    if (Array.isArray(params.cat)) {

      const categories = params.cat.map(id => {
        const obj = new Parse.Object('Category')
        obj.id = id
        return obj
      })

      if (categories.length) {
        query.containedIn('categories', categories)
      }

    } else if (typeof params.cat === 'string') {
      const category = new Parse.Object('Category')
      category.id = params.cat
      query.equalTo('categories', category)
    }

  }

  if (Array.isArray(params.bounds) && params.bounds.length) {

    const southwest = new Parse.GeoPoint(
      params.bounds[0].latitude,
      params.bounds[0].longitude
    );

    const northeast = new Parse.GeoPoint(
      params.bounds[1].latitude,
      params.bounds[1].longitude
    );

    query.withinGeoBox('location', southwest, northeast)

  } else if (params.latitude && params.longitude) {

    const point = new Parse.GeoPoint({
      latitude: params.latitude,
      longitude: params.longitude,
    })

    const sorted = (params.nearby === '1' || params.sortByField === 'location') ? true : false;

    if (params.unit === 'km' && searchRadius) {
      query.withinKilometers('location', point, searchRadius / 1000, sorted)
      console.log();
    } else if (params.unit == 'mi' && searchRadius) {
      query.withinMiles('location', point, searchRadius / 1609, sorted)
    } else {
      query.near('location', point)
    }

  }

  if (params.sortBy && params.sortByField !== 'location') {
    if (params.sortBy === 'asc') {
      query.ascending(params.sortByField)
    } else if (params.sortBy === 'desc') {
      query.descending(params.sortByField)
    }
  } else if (params.nearby !== '1' && params.sortByField !== 'location') {
    query.descending('createdAt')
  }

  query.doesNotExist('deletedAt')

  if (params.count) {
    return query.count()
  }

  query.include('categories')

  let featuredPlaces = []

  const shuffle = (arr) => {
    return arr.map((a) => [Math.random(), a]).sort((a, b) => a[0] - b[0]).map((a) => a[1]);
  }

  if (params.page === 0 && params.featured !== '1') {

    const featuredQuery = Parse.Query.fromJSON('Place', query.toJSON())
    featuredQuery.equalTo('isFeatured', true)

    featuredPlaces = await featuredQuery.find()

    if (!params.nearby) {
      featuredPlaces = shuffle(featuredPlaces)
    }

  }

  if (params.featured === '1') {
    query.equalTo('isFeatured', true)
  } else {
    query.equalTo('isFeatured', false)
  }

  if (params.user) {
    query.equalTo('user', params.user)
  }

  if (params.category) {
    query.equalTo('categories', params.category)
  }

  query.skip(page * limit)
  query.limit(limit)

  let places = await query.find()

  return [...featuredPlaces, ...places]

})

Parse.Cloud.define('isPlaceStarred', async (req) => {

  const user = req.user
  const placeId = req.params.placeId

  if (!user) throw 'Not Authorized'

  const objPlace = new Parse.Object('Place')
  objPlace.id = placeId

  const query = new Parse.Query('Review')
  query.equalTo('place', objPlace)
  query.equalTo('user', user)

  const review = await query.first()
  const isStarred = review ? true : false
  return isStarred
})

Parse.Cloud.define('isPlaceLiked', async (req) => {

  const user = req.user
  const placeId = req.params.placeId

  if (!user) throw 'Not Authorized'

  const query = new Parse.Query('Place')
  query.equalTo('likes', user)
  query.equalTo('objectId', placeId)

  const place = await query.first()
  const isLiked = place ? true : false
  return isLiked

})

Parse.Cloud.define('likePlace', async (req) => {

  const user = req.user
  const placeId = req.params.placeId

  if (!user) throw 'Not Authorized'

  const query = new Parse.Query('Place')
  const place = await query.get(placeId)

  if (!place) throw ('Record not found')

  const query1 = new Parse.Query('Place')
  query1.equalTo('likes', user)
  query1.equalTo('objectId', placeId)
  const isLiked = await query1.first()

  const relation = place.relation('likes')

  let response

  if (isLiked) {
    place.increment('likeCount', -1)
    relation.remove(user)
    response = false
  } else {
    place.increment('likeCount', 1)
    relation.add(user)
    response = true
  }

  await place.save(null, {
    useMasterKey: true
  })

  if (!isLiked) {

    const event = new Parse.Object('AppEvent')
    event.set('user', user)
    event.set('place', place)
    event.set('type', 'like')

    event.save(null, { useMasterKey: true })
  }

  return response

})

Parse.Cloud.beforeSave('Place', async (req) => {

  const obj = req.object
  const attrs = obj.attributes
  const original = req.original
  const origAttrs = original ? original.attributes : {}
  const user = req.user

  if (!user && !req.master) throw 'Not Authorized'

  if (!obj.existed()) {
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(true)
    acl.setRoleWriteAccess('Admin', true)
    obj.setACL(acl)
    obj.set('status', attrs.status || 'Pending')
    obj.set('user', attrs.user || user)
    obj.set('ratingAvg', 0)
    obj.set('isFeatured', attrs.isFeatured || false)
  }

  const canonical = obj.get('title').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  obj.set('canonical', canonical)
  obj.set('slug', slug(obj.get('title')))

  if (obj.dirtyKeys().includes('expiresAt') && attrs.expiresAt === null) {
    obj.unset('expiresAt')
  }

  const promises = []

  if (obj.get('image') && obj.dirty('image')) {

    const url = obj.get('image').url()

    const promise = Parse.Cloud.httpRequest({
      url: url
    }).then(httpResponse => {
      return sharp(httpResponse.buffer)
        .jpeg({ quality: 80, progressive: true })
        .resize({
          width: 800,
          withoutEnlargement: true,
          fit: 'inside',
        })
        .toBuffer()
    }).then(imageData => {
      return new Parse.File('image.jpg', {
        base64: imageData.toString('base64')
      }).save()
    }).then(savedFile => {
      obj.set('image', savedFile)
    })

    promises.push(promise)

    const promiseThumb = Parse.Cloud.httpRequest({
      url: url
    }).then(httpResponse => {
      return sharp(httpResponse.buffer)
        .jpeg({ quality: 80, progressive: true })
        .resize(480, 480)
        .toBuffer()
    }).then(imageData => {
      return new Parse.File('image.jpg', {
        base64: imageData.toString('base64')
      }).save()
    }).then(savedFile => {
      obj.set('imageThumb', savedFile)
    })

    promises.push(promiseThumb)
  } else if (!obj.get('image') && obj.dirty('image')) {
    obj.set('imageThumb', null)
  }

  await Promise.all(promises)

  // Resize gallery images

  if (attrs.images && attrs.images.length && obj.dirty('images')) {

    const resizedImages = []

    for (let image of attrs.images) {

      let shouldResize = false

      if (!obj.existed()) {
        shouldResize = true
      } else {
        shouldResize = !origAttrs.images
          .find(img => img.name() === image.name())
      }

      if (shouldResize) {
        const { buffer } = await Parse.Cloud.httpRequest({
          url: image.url()
        })

        const imageData = await sharp(buffer)
          .jpeg({ quality: 80, progressive: true })
          .resize({
            width: 1200,
            withoutEnlargement: true,
            fit: 'inside',
          })
          .toBuffer()

        const file = new Parse.File('photo.jpg', {
          base64: imageData.toString('base64')
        })

        await file.save()

        resizedImages.push(file)
      } else {
        resizedImages.push(image)
      }
    }

    obj.set('images', resizedImages)
  }

  if (typeof obj.get('images') === 'undefined') {
    obj.set('images', [])
  }

  // Import photos from Google Place API
  if (Array.isArray(attrs.googlePhotos) && attrs.googlePhotos.length) {

    const photos = []

    for (const photo of attrs.googlePhotos) {

      const httpResponse = await axios.get(photo, {
        responseType: 'arraybuffer'
      })

      const base64 = Buffer
        .from(httpResponse.data, 'binary')
        .toString('base64')

      const file = await new Parse.File('image.jpg', { base64 })
        .save()

      await file.save()

      photos.push(file)
    }

    const images = obj.get('images') || []
    images.push(...photos)
    obj.set('images', images)
    obj.unset('googlePhotos')
  }

  if (!obj.existed() &&
    !obj.get('image') &&
    obj.get('images') &&
    obj.get('images').length) {

    const image = obj.get('images')[0]
    obj.set('image', image)

    const { buffer } = await Parse.Cloud.httpRequest({
      url: image.url()
    })

    const imageData = await sharp(buffer)
      .jpeg({ quality: 70, progressive: true })
      .resize(480, 480)
      .toBuffer()

    const thumb = await new Parse.File('image.jpg', {
      base64: imageData.toString('base64')
    }).save()

    obj.set('imageThumb', thumb)
  }

})

Parse.Cloud.afterSave('Place', async (req) => {

  const user = req.user
  const obj = req.object
  const attrs = obj.attributes

  // Send email notification to admin of new places

  if (!obj.existed()) {

    try {

      const query = new Parse.Query(Parse.Role)
      query.equalTo('name', 'Admin')
      query.equalTo('users', attrs.user)

      const isAdmin = await query.first({ useMasterKey: true })

      if (!isAdmin) {

        const queryConfig = new Parse.Query('AppConfig')

        const config = await queryConfig.first({
          useMasterKey: true
        })

        if (!config) return

        const emailConfig = config.get('email')

        const toAddress = emailConfig.addressForNotifications

        await attrs.user.fetch({ useMasterKey: true })

        const authData = attrs.user.get('authData')

        let name = attrs.user.get('name')
        let username = attrs.user.get('username')

        let user = ''

        if (authData) {

          if (authData['anonymous']) {
            user = __('GUEST')
          } else {
            user = `${name} (${__('SOCIAL_LOGIN')})`
          }

        } else {
          user = `${name} (${username})`
        }

        let body = __('EMAIL_BODY_NEW_PLACE')
        body = body.replace('%PLACE_NAME%', attrs.title)
        body = body.replace('%PLACE_DESCRIPTION%', attrs.description || '---')
        body = body.replace('%USER_NAME%', user)
        body = body.replace(/\n/g, '<br />');

        const apiKey = process.env.GOOGLE_MAPS_API_KEY

        const src = `https://maps.googleapis.com/maps/api/staticmap?key=${apiKey}
      &markers=color:0xff7676%7C${attrs.location.latitude},${attrs.location.longitude}
      &zoom=17&format=png&size=640x220&scale=2`

        const map = `<img style="max-width:100%;height:auto;display:block;border-radius:16px" src="${src}" />`

        const email = {
          body: {
            title: __('EMAIL_TITLE_NEW_PLACE'),
            intro: [body, map],
            signature: false,
          }
        }

        const mailgunHelper = new MailgunHelper({
          apiKey: process.env.MAILGUN_API_KEY,
          domain: process.env.MAILGUN_DOMAIN,
          host: process.env.MAILGUN_HOST,
        })

        const mailGenerator = new Mailgen({
          theme: 'default',
          product: {
            name: process.env.APP_NAME,
            link: process.env.MAILGUN_PUBLIC_LINK,
            copyright: __('EMAIL_COPYRIGHT')
          }
        })

        mailgunHelper.send({
          subject: __('EMAIL_SUBJECT_NEW_PLACE'),
          from: process.env.MAILGUN_FROM_ADDRESS,
          to: toAddress,
          html: mailGenerator.generate(email),
        })

      }

    } catch (error) {
      console.log(error)
    }

  }

})

Parse.Cloud.afterDelete('Place', async (req) => {

  const obj = req.object

  try {

    const query = new Parse.Query('Review')
    query.equalTo('place', obj)
    const count = await query.count()
    query.limit(count)
    const results = await query.find()
    await Parse.Object.destroyAll(results, {
      useMasterKey: true
    })

  } catch (err) {
    console.warn(err.message)
  }

})

Parse.Cloud.define('addSearchIndex', async () => {
  const schema = new Parse.Schema('Place')

  schema.addIndex('search_index', {
    tags: "text",
    canonical: "text"
  })

  return schema.update({ useMasterKey: true })
})

Parse.Cloud.job('addGeoIndex', async (req) => {

  const { message } = req

  message(`Job started at ${new Date().toISOString()}`)

  try {
    const schema = new Parse.Schema('Place')

    schema.addIndex('geo_index', {
      location: '2dsphere'
    })

    await schema.update({ useMasterKey: true })

    message(`Job finished at ${new Date().toISOString()}`)

  } catch (error) {
    message(error.message)
  }

})

Parse.Cloud.define('getPlaceStatistics', async (req) => {

  const placeId = req.params.placeId
  const startDate = req.params.startDate
  const endDate = req.params.endDate
  const user = req.user

  if (!user) throw 'Not Authorized'

  const place = new Parse.Object('Place')
  place.id = placeId

  await place.fetch()

  if (!startDate && !endDate) {
    return {
      views: place.get('viewCount') || 0,
      calls: place.get('callCount') || 0,
      likes: place.get('likeCount') || 0,
    }
  }

  const query = new Parse.Query('AppEvent')
  query.equalTo('place', place)
  query.equalTo('type', 'view')

  if (startDate) {
    query.greaterThanOrEqualTo('createdAt', startDate)
  }

  if (endDate) {
    query.lessThanOrEqualTo('createdAt', endDate)
  }

  const views = await query.count({ useMasterKey: true })
  query.equalTo('type', 'call')
  const calls = await query.count({ useMasterKey: true })
  query.equalTo('type', 'like')
  const likes = await query.count({ useMasterKey: true })

  return { views, calls, likes }
})

Parse.Cloud.define('trackViewPlace', async (req) => {

  const query = new Parse.Query('Place')
  const place = await query.get(req.params.placeId)

  const objs = []

  const appEvent = new Parse.Object('AppEvent')
  appEvent.set('user', req.user)
  appEvent.set('place', place)
  appEvent.set('type', 'view')

  objs.push(appEvent)

  place.increment('viewCount')

  objs.push(place)

  return Parse.Object.saveAll(objs, {
    useMasterKey: true
  })
})

Parse.Cloud.define('trackCallPlace', async (req) => {

  const query = new Parse.Query('Place')
  const place = await query.get(req.params.placeId)

  const objs = []

  const appEvent = new Parse.Object('AppEvent')
  appEvent.set('user', req.user)
  appEvent.set('place', place)
  appEvent.set('type', 'call')

  objs.push(appEvent)

  place.increment('callCount')

  objs.push(place)

  return Parse.Object.saveAll(objs, {
    useMasterKey: true
  })
})

Parse.Cloud.define('getPlacesWithUser', async (req) => {

  const { master, params, user, } = req

  if (!user && !master) throw 'Not Authorized'

  if (user) {
    const isAdmin = await Utils.isAdmin(user)
    if (!isAdmin) throw 'Not Authorized'
  }

  const query = new Parse.Query('Place')

  if (params.query) {
    query.contains('canonical', params.query.toLowerCase())
  }

  if (params.user) {
    query.equalTo('user', params.user)
  }

  if (params.status) {
    query.equalTo('status', params.status)
  }

  if (params.categories && params.categories.length) {
    query.containedIn('categories', params.categories)
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
  query.include(['categories', 'user', 'userPackage'])
  query.doesNotExist('deletedAt')

  return query.find({ useMasterKey: true })

})

Parse.Cloud.define('getPlaceWithUser', async (req) => {

  const { master, params, user, } = req

  if (!user && !master) throw 'Not Authorized'

  if (user) {
    const isAdmin = await Utils.isAdmin(user)
    if (!isAdmin) throw 'Not Authorized'
  }

  const query = new Parse.Query('Place')

  query.include(['categories', 'user', 'userPackage'])
  query.doesNotExist('deletedAt')

  return query.get(params.id, { useMasterKey: true })

})