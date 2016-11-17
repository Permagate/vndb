const { expect } = require('chai');
const VNDBConstants = require('../../lib/vndb-constants');

describe('VNDB constants', () => {
  describe('Server constants', () => {
    it('should contain VNDB API host and port', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.host');
      expect(VNDBConstants).to.have.deep.property('defaults.port');
    });

    it('should default to use TLS port', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.port', 19535);
    });
  });

  describe('Login constants', () => {
    it('should contain default login properties', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.protocol');
      expect(VNDBConstants).to.have.deep.property('defaults.client');
      expect(VNDBConstants).to.have.deep.property('defaults.clientver');
      expect(VNDBConstants).to.have.deep.property('defaults.username');
      expect(VNDBConstants).to.have.deep.property('defaults.password');
    });

    it('should not define truthy username and password', () => {
      expect(VNDBConstants.defaults.username).to.not.exist;
      expect(VNDBConstants.defaults.password).to.not.exist;
    });
  });

  describe('get parameter constants', () => {
    it('should contain default parameters for vn function', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.vn.flags');
      expect(VNDBConstants).to.have.deep.property('defaults.vn.filters');
    });

    it('should contain default parameters for release function', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.release.flags');
      expect(VNDBConstants).to.have.deep.property('defaults.release.filters');
    });

    it('should contain default parameters for producer function', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.producer.flags');
      expect(VNDBConstants).to.have.deep.property('defaults.producer.filters');
    });

    it('should contain default parameters for character function', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.character.flags');
      expect(VNDBConstants).to.have.deep.property('defaults.character.filters');
    });

    it('should contain default parameters for user function', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.user.flags');
      expect(VNDBConstants).to.have.deep.property('defaults.user.filters');
    });

    it('should contain default parameters for votelist function', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.votelist.flags');
      expect(VNDBConstants).to.have.deep.property('defaults.votelist.filters');
    });

    it('should contain default parameters for vnlist function', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.vnlist.flags');
      expect(VNDBConstants).to.have.deep.property('defaults.vnlist.filters');
    });

    it('should contain default parameters for wishlist function', () => {
      expect(VNDBConstants).to.have.deep.property('defaults.wishlist.flags');
      expect(VNDBConstants).to.have.deep.property('defaults.wishlist.filters');
    });

  });

  describe('Other constants', () => {
    it('should have terminator', () => {
      expect(VNDBConstants).to.have.deep.property('terminator');
    });

    it('should contain list of allowed options', () => {
      expect(VNDBConstants).to.have.deep.property('allowedOptions');
    });
  });
});

