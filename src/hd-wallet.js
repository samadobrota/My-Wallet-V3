'use strict';

module.exports = HDWallet;
////////////////////////////////////////////////////////////////////////////////
var Bitcoin = require('bitcoinjs-lib');
var assert  = require('assert');
var Helpers = require('./helpers');
var HDAccount = require('./hd-account');
var WalletCrypto = require('./wallet-crypto');
var BIP39 = require('bip39');
var MyWallet = require('./wallet'); // This cyclic import should be avoided once the refactor is complete
////////////////////////////////////////////////////////////////////////////////
// Address class
function HDWallet(object){

  function addAccount (o, index){
    o.index = index;
    return HDAccount.factory(o);
  };

  // private members
  var obj      = object || {};
  obj.accounts = obj.accounts || [];
  obj.paidTo   = obj.paidTo || {};

  this._seedHex             = obj.seed_hex;
  this._bip39Password       = obj.passphrase;
  this._mnemonic_verified   = obj.mnemonic_verified;
  this._default_account_idx = obj.default_account_idx;
  this._accounts = obj.accounts ? obj.accounts.map(addAccount) : [];
  this._paidTo              = obj.paidTo;
}

Object.defineProperties(HDWallet.prototype, {
  "seedHex": {
    configurable: false,
    get: function() { return this._seedHex;}
  },
  "bip39Password": {
    configurable: false,
    get: function() { return this._bip39Password;}
  },
  "isMnemonicVerified": {
    configurable: false,
    get: function() { return this._mnemonic_verified;}
  },
  "defaultAccountIndex": {
    configurable: false,
    get: function() { return this._default_account_idx;},
    set: function(value) {
      if(this.isValidAccountIndex(value)){
        this._default_account_idx = value;
        MyWallet.syncWallet();
      }
      else{
        throw 'Error: unvalid default index account';
      };
    }
  },
  "defaultAccount": {
    configurable: false,
    get: function() {return this._accounts[this._default_account_idx];}
  },
  "accounts": {
    configurable: false,
    get: function() {
      return this._accounts.map(function(a){return a});
    }
  },
  "activeAccounts": {
    configurable: false,
    get: function() {
      return this._accounts.filter(function(a){return !a.archived});
    }
  },
  "xpubs":{
    configurable: false,
    get: function() {
      return this._accounts.map(function(a){return (a.extendedPublicKey)});
    }
  },
  "activeXpubs":{
    configurable: false,
    get: function() {
      return this.activeAccounts.map(function(a){return (a.extendedPublicKey)});
    }
  },
  "balanceActiveAccounts":{
    configurable: false,
    get: function() {
      var balances = this.activeAccounts.map(function(k){return k.balance;})
      if (balances.some(Helpers.isNotNumber)) return null;
      return balances.reduce(Helpers.add, 0);
    }
  },
  "isEncrypted": {
    configurable: false,
    get: function() {
      var isSeedEnc = Helpers.isBase64(this._seedHex) && !Helpers.isSeedHex(this._seedHex);
      return isSeedEnc && this._accounts.map(function(a){return a.isEncrypted;})
                                          .reduce(Helpers.and, true);
    }
  },
  "isUnEncrypted": {
    configurable: false,
    get: function() {
      var isSeedUnEnc = Helpers.isSeedHex(this._seedHex);
      return isSeedUnEnc && this._accounts.map(function(a){return a.isUnEncrypted;})
                             .reduce(Helpers.and, true);
    }
  },
  "lastAccount":{
    configurable: false,
    get: function() {
      return this._accounts[this._accounts.length-1];
    }
  }
});
////////////////////////////////////////////////////////////////////////////////
// non exposed functions
function decryptMnemonic (seedHex, cipher){
  if (cipher) {
    return BIP39.entropyToMnemonic(cipher(seedHex));
  } else {
    if (Helpers.isHex(seedHex)) {
      return BIP39.entropyToMnemonic(seedHex);
    } else {
      throw "Decryption function needed to get the mnemonic";
    };
  };
};

function decryptPassphrase (bip39Password, cipher){
  if (bip39Password === "") {return bip39Password};
  if (cipher) {
    return cipher(bip39Password);
  } else {
    return bip39Password;
  };
};

function getMasterHex (seedHex, bip39Password, cipher){
  var mnemonic   = decryptMnemonic(seedHex, cipher);
  var passphrase = decryptPassphrase(bip39Password, cipher);
  return BIP39.mnemonicToSeed(mnemonic, passphrase);
};
////////////////////////////////////////////////////////////////////////////////
// Constructors

// we need 3 actions
// new hdwallet
// load hdwallet
// restore hdwallet

HDWallet.new = function(cipher){
  var mnemonic = BIP39.generateMnemonic();
  var seedHex  = BIP39.mnemonicToEntropy(mnemonic);
  return HDWallet.restore(seedHex, '', cipher);
};

HDWallet.restore = function(seedHex, bip39Password, cipher){

  assert(Helpers.isString(seedHex), 'hdwallet.seedHex must exist');
  if (!Helpers.isString(bip39Password)) bip39Password = "";
  var hdwallet = {
    seed_hex            : seedHex,
    passphrase          : bip39Password,
    mnemonic_verified   : false,
    default_account_idx : 0,
    accounts            : []
  };
  var newHDwallet = new HDWallet(hdwallet);
  if (cipher) {
    newHDwallet.encrypt(cipher).persist();
  };
  return newHDwallet;
};

HDWallet.factory = function(o){
  if (o instanceof Object && !(o instanceof HDWallet)) {
    return new HDWallet(o);
  }
  else { return o; };
};

HDWallet.prototype.newAccount = function(label, cipher){

  var accIndex   = this._accounts.length;
  var dec = undefined;
  var enc = undefined;

  if (cipher) {
    dec    = cipher("dec");
    enc    = cipher("enc");
  };

  var masterhex = getMasterHex(this._seedHex, this._bip39Password, dec);
  var network   = Bitcoin.networks.bitcoin;
  var masterkey = Bitcoin.HDNode.fromSeedBuffer(masterhex, network);
  var account   = HDAccount.fromWalletMasterKey(masterkey, accIndex, label);
  account.encrypt(enc).persist();
  this._accounts.push(account);
  return this;
};
////////////////////////////////////////////////////////////////////////////////
// JSON serializer

HDWallet.prototype.toJSON = function(){

  var hdwallet = {
    seed_hex            : this._seedHex,
    passphrase          : this._bip39Password,
    mnemonic_verified   : this._mnemonic_verified,
    default_account_idx : this._default_account_idx,
    // paidTo              : this._paidTo,
    accounts            : this._accounts
  };
  return hdwallet;
};

HDWallet.reviver = function(k,v){
  if (k === '') return new HDWallet(v);
  return v;
}

////////////////////////////////////////////////////////////////////////////////
// methods

HDWallet.prototype.verifyMnemonic = function(){
  this._mnemonic_verified = true;
  MyWallet.syncWallet();
  return this;
};

HDWallet.prototype.account = function(xpub){
  var f = this._accounts
            .filter(function(a){return a.extendedPublicKey === xpub})
  var r = f.length === 0 ? null : f[0];
  return r;
};

HDWallet.prototype.activeAccount = function(xpub){
  var a = this.account(xpub);
  var r = !a || a.archived ? null : a;
  return r;
};

////////////////////////////////////////////////////////////////////////////////
// account managment

HDWallet.prototype.encrypt = function(cipher){
  function f(acc) {acc.encrypt(cipher);};
  this._accounts.forEach(f);
  this._temporal_seedHex = cipher(this._seedHex);
  this._temporal_bip39Password = this._bip39Password === ""
   ? this._bip39Password
   : cipher(this._bip39Password);
  return this;
};

HDWallet.prototype.decrypt = function(cipher){
  function f(acc) {acc.decrypt(cipher);};
  this._accounts.forEach(f);
  this._temporal_seedHex = cipher(this._seedHex);
  this._temporal_bip39Password = this._bip39Password === ""
   ? this._bip39Password
   : cipher(this._bip39Password);
  return this;
};

HDWallet.prototype.persist = function(){
  if (this._temporal_seedHex === undefined || this._temporal_bip39Password === undefined)
    {return this;};
  this._seedHex = this._temporal_seedHex;
  this._bip39Password = this._temporal_bip39Password;
  delete this._temporal_seedHex;
  delete this._temporal_bip39Password;
  function f(acc) {acc.persist();};
  this._accounts.forEach(f);
  return this;
};
////////////////////////////////////////////////////////////////////////////////
// paid to Dictionary
// {"txhash": {email:email, mobile: null, redeemedAt: null, address: "1x..."}}

HDWallet.prototype.addPaidToElement = function(txHash, element){
  this._paidTo[txHash] = element;
  MyWallet.syncWallet();
  return this;
};
HDWallet.prototype.getPaidToElement = function(txHash){
  return this._paidTo[txHash];
};
HDWallet.prototype.forEachPaidTo = function(f) {
  // f is a function taking (txHash, paidToElement)
  for (var txHash in this._paidTo) {
    f(txHash, this._paidTo[txHash]);
  };
  return this;
};
////////////////////////////////////////////////////////////////////////////////
// checkers
HDWallet.prototype.isValidAccountIndex = function(index){
  return Helpers.isNumber(index) && index >= 0 && index < this._accounts.length;
};
