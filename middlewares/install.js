module.exports = async (req, res, next) => {

  const url = req.originalUrl

  try {

    const query = new Parse.Query(Parse.User)
    query.equalTo('type', 'super_admin')
    const superAdmin = await query.first({ useMasterKey: true })

    if (!superAdmin) {

      if (url === '/') {
        res.redirect('/install')
      } else {
        next()
      }

    } else {

      if (url === '/') {
        next()
      } else {
        res.redirect('/')
      }

    }

  } catch (error) {
    res.send(error.message)
  }

}