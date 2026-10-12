// ═══════════════════════════════════════════════════════════════
//  CONFIG — Edit this single object to rebrand the entire site
// ═══════════════════════════════════════════════════════════════

const siteConfig = {
  // Brand
  name: "Ember & Quill",
  tagline: "Modern Nigerian dining, crafted over fire",
  currency: "₦",

  // Contact & Hours
  address: "42 Ember Lane, Wuse II, Abuja",
  phone: "+234 803 555 0142",
  email: "hello@emberandquill.ng",

  hours: [
    { days: "Mon — Thu", time: "12:00 PM – 10:00 PM" },
    { days: "Fri — Sat", time: "12:00 PM – 11:00 PM" },
    { days: "Sunday", time: "11:00 AM – 9:00 PM" }
  ],

  // Menu — all items in one place
  menu: [
    {
      category: "Starters",
      items: [
        { name: "Suya-Spiced Wings", desc: "Crispy chicken wings in suya pepper, charred spring onion", price: 4500 },
        { name: "Pepper Snails", desc: "Tender snails simmered in uziza and bonnet pepper", price: 6500 },
        { name: "Chin Chin Basket", desc: "Crunchy fried dough, suya dust, pepper dip", price: 3500 },
        { name: "Grilled Prawn Skewers", desc: "Tiger prawns, palm oil rub, lime crema", price: 7500 }
      ]
    },
    {
      category: "From the Fire",
      items: [
        { name: "Full Chicken Suya", desc: "Free-range chicken, yaji spice, smoked bone marrow", price: 9500 },
        { name: "Goat Meat Pepper Soup", desc: "Slow-brewed goat, uziza, scent leaf, native pepper", price: 8500 },
        { name: "Grilled Catfish", desc: "Whole catfish, chermoula, charred lemon", price: 12500 },
        { name: "Ember-Grilled Ribeye", desc: "45-day dry-aged, smoked marrow, charred scallion", price: 18000 }
      ]
    },
    {
      category: "Mains",
      items: [
        { name: "Jollof Rice & Grilled Chicken", desc: "Smoky party jollof, obokun pepper, fried plantain", price: 8500 },
        { name: "Banga Soup & Starch", desc: "Fresh palm fruit soup, assorted meat, seafood", price: 9500 },
        { name: "Egusi Soup & Pounded Yam", desc: "Melon seed soup, bitter leaf, goat meat", price: 10500 },
        { name: "Quill & Ink Pasta", desc: "Squid ink tagliatelle, chili oil, lemon breadcrumbs", price: 12500 },
        { name: "Seafood Okra Soup", desc: "Okra, prawns, periwinkles, locust beans", price: 11000 },
        { name: "Premium Striploin", desc: "500g striploin, bone marrow jus, garden herb salad", price: 25000 }
      ]
    },
    {
      category: "Desserts",
      items: [
        { name: "Smoked Plantain & Ice Cream", desc: "Caramelized plantain, coconut ice cream, palm sugar", price: 4000 },
        { name: "Chin Chin Cheesecake", desc: "Crunchy base, zobo compote, whipped cream", price: 5500 },
        { name: "Puff Puff & Pepper Sugar", desc: "Warm puff puff, chilli sugar, honey drizzle", price: 3000 },
        { name: "Akara Waffles", desc: "Bean flour waffles, caramelized banana, groundnut crumble", price: 4500 }
      ]
    },
    {
      category: "Drinks",
      items: [
        { name: "Zobo Spritz", desc: "Hibiscus, ginger, lime, soda", price: 3000 },
        { name: "Chapman", desc: "Fanta, Sprite, grenadine, cucumber, angostura", price: 2500 },
        { name: "Fresh Mango Juice", desc: "Ripe mangoes, blended fresh", price: 2000 },
        { name: "Hibiscus Cooler", desc: "Zobo, mint, lime, sparkling water", price: 1500 },
        { name: "The Quill's Old Fashioned", desc: "Rye whiskey, smoked maple, bitters, orange oils", price: 8000 },
        { name: "Palm Wine Sangria", desc: "Palm wine, seasonal fruit, brandy, herbs", price: 6500 },
        { name: "Suya Spice Margarita", desc: "Tequila, triple sec, lime, yaji salt rim", price: 7500 },
        { name: "Ginger Beer", desc: "House-made ginger beer, lime, mint", price: 1800 }
      ]
    }
  ],

  // Home page highlights (6 dishes)
  highlights: [
    { name: "Ember-Grilled Ribeye", desc: "45-day dry-aged, smoked marrow, charred scallion", price: 18000 },
    { name: "Full Chicken Suya", desc: "Free-range chicken, yaji spice, smoked bone marrow", price: 9500 },
    { name: "Grilled Catfish", desc: "Whole catfish, chermoula, charred lemon", price: 12500 },
    { name: "Jollof Rice & Grilled Chicken", desc: "Smoky party jollof, obokun pepper, fried plantain", price: 8500 },
    { name: "Smoked Plantain & Ice Cream", desc: "Caramelized plantain, coconut ice cream, palm sugar", price: 4000 },
    { name: "The Quill's Old Fashioned", desc: "Rye whiskey, smoked maple, bitters, orange oils", price: 8000 }
  ]
};
