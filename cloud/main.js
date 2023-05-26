// Import cloud functions
// Cloud code guide: https://docs.parseplatform.org/cloudcode/guide/

require('./category')
require('./notification')
require('./place')
require('./post')
require('./review')
require('./slider-image')
require('./user')
require('./util')
require('./app-config')
require('./parse-installation')
require('./page')
require('./slide-intro')
require('./report')
require('./package')
require('./user-package')
require('./app-event')

Parse.Cloud.define('getCollectionsCount', async (req) => {

  const { user, master } = req

  if (!user && !master) {
    throw 'Not authorized'
  }

  if (user && !['admin', 'super_admin'].includes(user.get('type'))) {
    throw 'Invalid user type'
  }

  const classes = [
    'Category',
    'Notification',
    'Page',
    'Place',
    'Post',
    'Review',
    'SlideIntro',
    'SliderImage',
    'Package',
    '_User',
    'UserPackage',
  ]

  const queries = classes.map(clazz => {
    const query = new Parse.Query(clazz)
    query.doesNotExist('deletedAt')
    return query
  })

  const promises = queries.map(query => query.count({ useMasterKey: true }))

  const [
    categories,
    notifications,
    pages,
    places,
    posts,
    reviews,
    slides,
    slide_images,
    packages,
    users,
    user_packages,
  ] = await Promise.all(promises)

  return {
    categories,
    notifications,
    pages,
    places,
    posts,
    reviews,
    slides,
    slide_images,
    packages,
    users,
    user_packages,
  }

})
