const Utils = require('../utils')
const sharp = require('sharp')

Parse.Cloud.beforeSave('Notification', async (req) => {

  const obj = req.object
  const user = req.user
  const attrs = obj.attributes

  if (!user && !req.master) throw 'Not Authorized'

  if (user) {
    const isAdmin = await Utils.isAdmin(user)
    if (!isAdmin) throw 'Not Authorized'
  }

  if (!obj.existed()) {
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(true)
    acl.setRoleWriteAccess('Admin', true)
    obj.setACL(acl)
  }

  if (obj.dirty('title') && attrs.title) {
    obj.set('canonical', attrs.title.toLowerCase())
  }

  if (obj.dirty('image') && attrs.image) {

    const { buffer } = await Parse.Cloud.httpRequest({
      url: attrs.image.url()
    })

    const imageResizedData = await sharp(buffer)
      .resize({
        width: 800,
        withoutEnlargement: true,
        fit: 'inside',
      })
      .toBuffer()

    const imageThumbData = await sharp(buffer)
      .resize(200, 200)
      .toBuffer()

    const file = new Parse.File('image.jpg', {
      base64: imageResizedData.toString('base64')
    })

    const thumb = new Parse.File('image.jpg', {
      base64: imageThumbData.toString('base64')
    })

    await Promise.all([file.save(), thumb.save()])

    obj.set('image', file)
    obj.set('imageThumb', thumb)
  } else if (obj.dirty('image') && !attrs.image) {
    obj.set('imageThumb', null)
  }

})

Parse.Cloud.afterSave('Notification', async (req) => {

  const obj = req.object
  const attrs = obj.attributes

  if (!obj.existed()) {

    const query = new Parse.Query(Parse.Installation)
    query.containedIn('deviceType', ['ios', 'android'])
    query.equalTo('isPushEnabled', true)

    const users = attrs.users

    if (Array.isArray(users) && users.length) {
      query.containedIn('user', users)
    }

    if (attrs.type === 'Geo') {

      const southwest = new Parse.GeoPoint(
        attrs.bounds.south,
        attrs.bounds.west
      );

      const northeast = new Parse.GeoPoint(
        attrs.bounds.north,
        attrs.bounds.east
      );

      query.withinGeoBox('location', southwest, northeast)
    }

    const pushParams = {
      where: query,
      data: {
        title: attrs.title,
        alert: attrs.message,
        sound: 'default',
      },
      notification: {
        title: attrs.title,
        body: attrs.message,
      }
    }

    if (attrs.place) {

      const place = await attrs.place.fetch({ useMasterKey: true })

      pushParams.data.placeId = place.id

      if (place.get('image')) {
        const imageUrl = place.get('image')._url
        pushParams.data['image_url'] = imageUrl
        pushParams.notification['image'] = imageUrl
        pushParams.data['mutable-content'] = 1
      }

    } else if (attrs.post) {

      const post = await attrs.post.fetch({ useMasterKey: true })

      pushParams.data.postId = post.id

      if (post.get('image')) {
        const imageUrl = post.get('image')._url
        pushParams.data['image_url'] = imageUrl
        pushParams.notification['image'] = imageUrl
        pushParams.data['mutable-content'] = 1
      }

    } else if (attrs.category) {

      const category = await attrs.category.fetch({ useMasterKey: true })

      pushParams.data.categoryId = category.id

      if (category.get('image')) {
        const imageUrl = category.get('image')._url
        pushParams.data['image_url'] = imageUrl
        pushParams.notification['image'] = imageUrl
        pushParams.data['mutable-content'] = 1
      }
    }

    if (attrs.image) {
      const imageUrl = attrs.image._url
      pushParams.data['image_url'] = imageUrl
      pushParams.notification['image'] = imageUrl
      pushParams.data['mutable-content'] = 1
    }

    await Parse.Push.send(pushParams, {
      useMasterKey: true
    })
  }

})