// zScanner hooks: settings (ideas 1, 2 and 4 from the proposal). Everything is OFF for recipients until switched on here.
// The admin page always shows a preview of all three. Fill in the addresses once Nico's module is ready.
window.ZHOOKS = {
  // switch each idea on for recipients (client page) when it is ready and approved
  enabled: { welcome: false, tasting: false, corporate: false },

  // Idea 1: welcome offer for new accounts
  welcome: {
    offer: "X% off your first order",                       // wording of the offer, once the discount is agreed
    signupUrl: "https://www.zchocolat.com/en/login?create_account=1&zs=1"   // exact sign-up address: Nico to confirm
  },

  // Idea 2: favourites email
  privacyUrl: "",                                           // zChocolat privacy policy page (to fill in)

  // The module's addresses (Nico). Left empty = nothing is sent (admin shows what would be sent instead).
  endpoints: {
    favourites: "",   // e.g. "https://www.zchocolat.com/module/zscanner/favourites"
    scan: "",         // e.g. "https://www.zchocolat.com/module/zscanner/scan"
    thanks: ""        // e.g. "https://www.zchocolat.com/module/zscanner/thanks"
  }
};
