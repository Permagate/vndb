const VNDBClient = require('../lib/vndb-client.js');

const client = new VNDBClient();

client.connect()
  .then(() => client.wishlist())
  .then((result) => {
    console.log(result);
    process.exit(0);
  })
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });

