const sharp = require('sharp')
const slug = require('limax')

Parse.Cloud.beforeFind('Post', async (req) => {
  const { query, user, master } = req

  if ((!user && !master) || (user && user.get('type') === 'customer')) {
    query.equalTo('status', 'Active')
  }
})

Parse.Cloud.beforeSave('Post', async (req) => {

  const obj = req.object
  const attrs = obj.attributes
  const user = req.user

  if (!user && !req.master) throw 'Not Authorized'

  if (!req.master) {
    const query = new Parse.Query(Parse.Role)
    query.equalTo('name', 'Admin')
    query.equalTo('users', user)

    const adminRole = await query.first({ useMasterKey: true })

    if (!adminRole) throw 'Not Authorized'
  }

  if (!obj.existed()) {
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(true)
    acl.setRoleWriteAccess('Admin', true)
    obj.setACL(acl)
  }

  if (obj.dirty('title')) {
    obj.set('canonical', attrs.title.toLowerCase())
  }

  obj.set('slug', slug(attrs.title))

  if (attrs.image && obj.dirty('image')) {

    const httpResponse = await Parse.Cloud.httpRequest({
      url: attrs.image.url()
    })

    const imageResizedData = await sharp(httpResponse.buffer)
      .resize({
        width: 800,
        withoutEnlargement: true,
        fit: 'inside',
      })
      .toBuffer()

    const imageThumbData = await sharp(httpResponse.buffer)
      .resize(200, 200)
      .toBuffer()

    const file = new Parse.File('image.jpg', {
      base64: imageResizedData.toString('base64')
    })

    const thumb = new Parse.File('image.jpg', {
      base64: imageThumbData.toString('base64')
    })

    await file.save()
    await thumb.save()

    obj.set('image', file)
    obj.set('imageThumb', thumb)

  } else if (obj.dirty('image') && !attrs.image) {
    obj.set('imageThumb', null)
  }
})

Parse.Cloud.afterSave('Post', (req) => {

  const obj = req.object
  const attrs = obj.attributes
  const originalAttrs = req.original ? req.original.attributes : {}

  if (
    (!obj.existed() && attrs.isPushEnabled && attrs.status === 'Active') ||
    (obj.existed() && attrs.isPushEnabled && attrs.status === 'Active' && originalAttrs.status === 'Pending')) {

    const notification = new Parse.Object('Notification')
    notification.set('title', attrs.title)
    notification.set('message', attrs.body)
    notification.set('image', attrs.image)
    notification.set('type', 'All')
    notification.set('post', obj)
    notification.save(null, { useMasterKey: true })
  }

})