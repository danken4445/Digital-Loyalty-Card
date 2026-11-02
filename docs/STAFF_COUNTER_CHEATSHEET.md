# THE CAFFEINE PLUG — BARISTA COUNTER CHEATSHEET

> **Store Rule:** 1 stamp per qualifying drink ordered.  
> **Reward:** 10 stamps = 1 free coffee of choice.  
> **Print Tip:** Print this page and keep it laminated right beside the cash register.

---

## 1. New Customer? (First-Time Visit)

When a customer does not have a digital card yet:

1. Point to the acrylic counter standee:  
   _"Scan this QR code with your phone camera to get your digital stamp card!"_
2. Their phone opens `https://card.thecaffeineplug.ph/card`.
3. Customer taps the white button: **"GET MY CARD"**.
4. Their card loads instantly with 0 of 10 stamps. No app to download. No account to fill out.

---

## 2. Giving a Stamp on Drink Purchase

Hold the shop's physical black NFC card against the customer's phone:

- **For iPhone Users:**  
  Hold the card flat against the **TOP BACK EDGE** of the iPhone (next to the top camera lenses).
- **For Android Users:**  
  Hold the card flat against the **CENTER BACK** of the phone.  
  _(If nothing happens, make sure NFC is switched ON in their phone's swipe-down settings)._

The customer's phone will chime and open their card with their new stamp count.

---

## 3. What the Tap Banners Mean

When the customer's phone opens, look at the banner at the top of their screen:

| Screen Banner         | Icon          | What It Means & What to Say                                                                                                                                                       |
| :-------------------- | :------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STAMP COLLECTED**   | `✓` Checkmark | **Success!** 1 stamp was added to their card. Say: _"Thanks for visiting The Caffeine Plug!"_                                                                                     |
| **COOLDOWN ACTIVE**   | `!` Warning   | **30-minute cooldown.** Stamps require 30 minutes between visits. Say: _"You just got a stamp a few minutes ago. You can earn your next stamp on your next visit in 30 minutes!"_ |
| **DAILY CAP REACHED** | `!` Warning   | **Daily limit reached.** Customers can earn a maximum of 2 stamps per calendar day (Manila time). Say: _"You have hit today's 2-stamp limit. See you tomorrow!"_                  |
| **TAP THROTTLED**     | `!` Warning   | **Tapped too fast.** The card was tapped twice within 5 seconds. Wait 5 seconds and tap once more.                                                                                |
| **INACTIVE NFC TAG**  | `!` Warning   | **Card is deactivated.** Tell Dan (Owner) to rotate and reprogram this card. Use **Manual Stamp** below for this customer.                                                        |

---

## 4. Redeeming a Free Coffee (At 10 Stamps)

When a customer reaches 10 stamps, a gold/white **"CLAIM REWARD"** box appears on their card:

1. Ask customer to tap **"CLAIM REWARD"** on their screen.
2. A 5-minute QR code with an 8-character verification code (`XXXX-XXXX`) will appear on their phone.
3. On your store tablet or phone, open: `https://card.thecaffeineplug.ph/staff/redeem`
4. Scan the customer's QR code (or type their 8-character verification code).
5. Tap **Preview** to verify their stamp balance (must show 10 available stamps).
6. Tap **Confirm Redemption**.
7. The system deducts 10 stamps and records the redemption in the store log.
8. Make and serve their free coffee!

_Note:_ If the customer's QR code says "EXPIRED", ask them to tap the "Refresh Code" button to generate a new 5-minute pass.

### 4b. Instagram Follow = Free Upsize (One Time Per Card)

Every card shows a **"FOLLOW US, SIZE UP"** box. Customers who follow **@thecaffeineplug8400** get one free upsize on any drink:

1. Customer taps **FOLLOW @THECAFFEINEPLUG8400**, follows us in Instagram, then taps **CLAIM UPSIZE**.
2. A 5-minute QR code with an 8-character code appears on their phone.
3. Open `/staff/redeem`, scan the QR, tap **Verify Token**. The badge says **INSTAGRAM PERK • FREE UPSIZE**.
4. **Check the follow:** ask them to open our Instagram profile on their phone. The button must say **Following**.
5. Tap **Follow Checked — Grant Free Upsize**, then upsize their drink at no charge. **No stamps are used.**

_Note:_ The app can't check Instagram follows on its own (Instagram doesn't allow it), so step 4 is what stops fake claims. If the badge says **UPSIZE ALREADY USED**, that card has already had its upsize.

---

## 5. Manual Stamp Fallback (No NFC / Broken Phone)

Use this when a customer's phone has broken NFC or does not support NFC:

1. On your store device, open: `https://card.thecaffeineplug.ph/staff/stamp`
2. Ask the customer to scroll to the very bottom of their loyalty card on their phone.
3. Have them read out their **Customer UUID** (or copy it from their screen).
4. Enter their Customer UUID into the form.
5. In the Reason box, enter a quick note (e.g., `Customer phone has broken NFC hardware` or `Old Android phone`).
6. Tap **Issue Manual Stamp**.
7. Confirm that the green success message appears.

---

## 6. Emergency Contacts & Quick Links

- **Store Staff Portal:** `https://card.thecaffeineplug.ph/staff`
- **Redeem Free Drink:** `https://card.thecaffeineplug.ph/staff/redeem`
- **Manual Stamp Tool:** `https://card.thecaffeineplug.ph/staff/stamp`
- **Lost or Stolen NFC Card:** Inform Dan (Owner) immediately. Dan will log in to `/staff/tags` and click **"Rotate"** to permanently disable the old card and activate a replacement.
