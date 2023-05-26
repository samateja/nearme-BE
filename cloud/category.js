const sharp = require('sharp')
const slug = require('limax')

Parse.Cloud.beforeSave('Category', async (req) => {

  const obj = req.object
  const attrs = obj.attributes
  const user = req.user

  if (!user && !req.master) throw 'Not Authorized'

  if (user) {
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
    obj.set('placeCount', 0)
  }

  if (obj.dirty('title') && attrs.title) {
    obj.set('canonical', attrs.title.toLowerCase())
  }

  obj.set('slug', slug(attrs.title))

  if (obj.dirty('image') && attrs.image) {

    const { buffer } = await Parse.Cloud.httpRequest({
      url: attrs.image.url()
    })

    const imageThumbData = await sharp(buffer)
      .resize(200, 200)
      .toBuffer()

    const thumb = new Parse.File('image.jpg', {
      base64: imageThumbData.toString('base64')
    })

    await thumb.save()

    obj.set('imageThumb', thumb)
  } else if (obj.dirty('image') && !attrs.image) {
    obj.set('imageThumb', null)
  }
})

Parse.Cloud.beforeDelete('Category', async (req) => {

  const obj = req.object

  const query = new Parse.Query('Place')
  query.equalTo('category', obj)
  const result = await query.first()

  if (result) throw 'Can\'t delete category if it still has places'

})