// ═══════════════════════════════════════════════════════════════
//  CONFIG — Edit this single object to rebrand the entire site
// ═══════════════════════════════════════════════════════════════

const siteConfig = {
  // Brand
  name: "Ember & Quill",
  tagline: "Modern Nigerian dining, crafted over fire",
  currency: "₦",

  // Contact & Hours
  address: "42 Ember Lane, Wuse II, Abuja, Nigeria",
  phone: "07063134521",
  phoneIntl: "+2347063134521",
  email: "hello@emberandquill.ng",

  hours: [
    { days: "Mon — Thu", time: "12:00 PM – 10:00 PM" },
    { days: "Fri — Sat", time: "12:00 PM – 11:00 PM" },
    { days: "Sunday", time: "11:00 AM – 9:00 PM" }
  ],

  // Menu — all items in one place. `image` is the file in /images (placeholder photos).
  menu: [
    {
      category: "Starters",
      items: [
        { name: "Suya-Spiced Wings", desc: "Crispy chicken wings in suya pepper, charred spring onion", price: 4500, image: "suya-wings.jpg" },
        { name: "Pepper Snails", desc: "Tender snails simmered in uziza and bonnet pepper", price: 6500, image: "pepper-snails.jpg" },
        { name: "Chin Chin Basket", desc: "Crunchy fried dough, suya dust, pepper dip", price: 3500, image: "chin-chin.jpg" },
        { name: "Grilled Prawn Skewers", desc: "Tiger prawns, palm oil rub, lime crema", price: 7500, image: "grilled-prawns.jpg" }
      ]
    },
    {
      category: "From the Fire",
      items: [
        { name: "Full Chicken Suya", desc: "Free-range chicken, yaji spice, smoked bone marrow", price: 9500, image: "chicken-suya.jpg" },
        { name: "Goat Meat Pepper Soup", desc: "Slow-brewed goat, uziza, scent leaf, native pepper", price: 8500, image: "goat-pepper-soup.jpg" },
        { name: "Grilled Catfish", desc: "Whole catfish, chermoula, charred lemon", price: 12500, image: "grilled-catfish.jpg" },
        { name: "Ember-Grilled Ribeye", desc: "45-day dry-aged, smoked marrow, charred scallion", price: 18000, image: "ribeye.jpg" }
      ]
    },
    {
      category: "Mains",
      items: [
        { name: "Jollof Rice & Grilled Chicken", desc: "Smoky party jollof, obokun pepper, fried plantain", price: 8500, image: "jollof-rice.jpg" },
        { name: "Banga Soup & Starch", desc: "Fresh palm fruit soup, assorted meat, seafood", price: 9500, image: "banga-soup.jpg" },
        { name: "Egusi Soup & Pounded Yam", desc: "Melon seed soup, bitter leaf, goat meat", price: 10500, image: "egusi-soup.jpg" },
        { name: "Quill & Ink Pasta", desc: "Squid ink tagliatelle, chili oil, lemon breadcrumbs", price: 12500, image: "ink-pasta.jpg" },
        { name: "Seafood Okra Soup", desc: "Okra, prawns, periwinkles, locust beans", price: 11000, image: "seafood-okra.jpg" },
        { name: "Premium Striploin", desc: "500g striploin, bone marrow jus, garden herb salad", price: 25000, image: "striploin.jpg" }
      ]
    },
    {
      category: "Desserts",
      items: [
        { name: "Smoked Plantain & Ice Cream", desc: "Caramelized plantain, coconut ice cream, palm sugar", price: 4000, image: "plantain-ice-cream.jpg" },
        { name: "Chin Chin Cheesecake", desc: "Crunchy base, zobo compote, whipped cream", price: 5500, image: "chin-chin-cheesecake.jpg" },
        { name: "Puff Puff & Pepper Sugar", desc: "Warm puff puff, chilli sugar, honey drizzle", price: 3000, image: "puff-puff.jpg" },
        { name: "Akara Waffles", desc: "Bean flour waffles, caramelized banana, groundnut crumble", price: 4500, image: "akara-waffles.jpg" }
      ]
    },
    {
      category: "Drinks",
      items: [
        { name: "Zobo Spritz", desc: "Hibiscus, ginger, lime, soda", price: 3000, image: "zobo-spritz.jpg" },
        { name: "Chapman", desc: "Fanta, Sprite, grenadine, cucumber, angostura", price: 2500, image: "chapman.jpg" },
        { name: "Fresh Mango Juice", desc: "Ripe mangoes, blended fresh", price: 2000, image: "mango-juice.jpg" },
        { name: "Hibiscus Cooler", desc: "Zobo, mint, lime, sparkling water", price: 1500, image: "hibiscus-cooler.jpg" },
        { name: "The Quill's Old Fashioned", desc: "Rye whiskey, smoked maple, bitters, orange oils", price: 8000, image: "old-fashioned.jpg" },
        { name: "Palm Wine Sangria", desc: "Palm wine, seasonal fruit, brandy, herbs", price: 6500, image: "palm-wine-sangria.jpg" },
        { name: "Suya Spice Margarita", desc: "Tequila, triple sec, lime, yaji salt rim", price: 7500, image: "margarita.jpg" },
        { name: "Ginger Beer", desc: "House-made ginger beer, lime, mint", price: 1800, image: "ginger-beer.jpg" }
      ]
    }
  ],

  // Home page highlights (6 dishes) — images mirror the menu entries
  highlights: [
    { name: "Ember-Grilled Ribeye", desc: "45-day dry-aged, smoked marrow, charred scallion", price: 18000, image: "ribeye.jpg" },
    { name: "Full Chicken Suya", desc: "Free-range chicken, yaji spice, smoked bone marrow", price: 9500, image: "chicken-suya.jpg" },
    { name: "Grilled Catfish", desc: "Whole catfish, chermoula, charred lemon", price: 12500, image: "grilled-catfish.jpg" },
    { name: "Jollof Rice & Grilled Chicken", desc: "Smoky party jollof, obokun pepper, fried plantain", price: 8500, image: "jollof-rice.jpg" },
    { name: "Smoked Plantain & Ice Cream", desc: "Caramelized plantain, coconut ice cream, palm sugar", price: 4000, image: "plantain-ice-cream.jpg" },
    { name: "The Quill's Old Fashioned", desc: "Rye whiskey, smoked maple, bitters, orange oils", price: 8000, image: "old-fashioned.jpg" }
  ],

  // Reviews
  reviews: [
    { name: "Adaeze", rating: 5, text: "The suya wings were incredible — smoky, spicy, and perfectly charred. Best I've had in Abuja." },
    { name: "Tunde", rating: 5, text: "Booked for a birthday dinner. The ribeye was outstanding and the service was warm and attentive." },
    { name: "Ngozi", rating: 4, text: "Great atmosphere and the jollof rice is the real deal. Will definitely be back with friends." }
  ]
};
