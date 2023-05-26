Parse.Cloud.beforeSave('AppEvent', async (req) => {

  const obj = req.object

  if (!req.master) throw 'Not Authorized'

  if (!obj.existed()) {
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(false)
    obj.setACL(acl)
  }

})