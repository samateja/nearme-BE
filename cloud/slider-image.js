const sharp = require('sharp')

Parse.Cloud.beforeSave('SliderImage', async (req) => {

  const obj = req.object
  const attrs = obj.attributes
  const user = req.user

  if (!user && !req.master) throw 'Not Authorized'

  const query = new Parse.Query(Parse.Role)
  query.equalTo('name', 'Admin')
  query.equalTo('users', user)

  const adminRole = await query.first({ useMasterKey: true })

  if (!adminRole) throw 'Not Authorized'

  if (!obj.existed()) {
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(true)
    acl.setRoleWriteAccess('Admin', true)
    obj.setACL(acl)
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