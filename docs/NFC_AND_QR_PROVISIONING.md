# The Caffeine Plug — NFC Card & Counter QR Provisioning Guide

**Audience:** Dan (Owner) and store managers  
**Brand:** The Caffeine Plug (Philippines)  
**Production Site URL:** `https://card.thecaffeineplug.ph`

---

## 1. What You Need Before Starting

To set up your physical counter equipment, gather these items:

1. **Blank NXP NTAG215 Cards or Stickers:**
   - Must use the **NTAG215** chip type (504 bytes readable/writable memory).
   - _Why this chip:_ NTAG215 is fully compatible with all modern iPhones and Android smartphones. Do not buy NTAG213 chips (memory is too small) or Mifare Classic chips (iPhones cannot read them).
2. **A Smartphone with NFC:**
   - Any iPhone 7 or newer (running iOS 14 or higher).
   - Any Android phone with NFC turned ON in quick settings.
3. **NFC Writing App (Free):**
   - Download **NFC Tools** by Wakdev from the Apple App Store or Google Play Store. (Alternatively, **NXP TagWriter** also works).
4. **Acrylic Tabletop Standee:**
   - An A6 or 4" x 6" vertical acrylic stand to hold the counter onboarding QR code at the register.

---

## 2. Part 1: Printing the Counter Onboarding QR Code

The counter standee sits directly next to your cash register. When a customer pays, point to this standee so they can scan the QR code and receive their digital stamp card on their phone.

### Step 1: Generate the Print Files

1. Open a terminal in your project directory on your computer.
2. Run this npm script:
   ```bash
   npm run qr:counter
   ```
3. This creates two files in your `public/brand/` folder:
   - `public/brand/counter-qr-card.svg` (High-definition vector QR code pointing to `https://card.thecaffeineplug.ph/card`).
   - `public/brand/counter-qr-poster.html` (Complete printable counter standee artwork featuring The Caffeine Plug logo, mascot, and instructions).

### Step 2: Print the Standee at 100% Scale

1. Open the file `public/brand/counter-qr-poster.html` in **Google Chrome** or **Microsoft Edge**.
2. Press `Ctrl + P` (on Windows) or `Cmd + P` (on Mac) to open the print dialog.
3. Apply these print settings:
   - **Destination:** Your office or counter printer (or "Save as PDF").
   - **Color:** Color (or high-contrast black-and-white).
   - **Paper Size:** A6 or 4" x 6" photo card (or standard A4 / Letter if trimming).
   - **Scale:** **100% / Default** (`TO VERIFY` exact wording in your browser).  
     _Important:_ Do not select "Fit to printable area" or "Scale to fit". Stretched or distorted QR codes will fail to scan quickly on older phone cameras.
   - **Margins:** None or Minimum.
4. Click **Print**.
5. Slide the printed sheet into your acrylic counter standee. Place it right in front of the customer ordering line.

---

## 3. Part 2: Creating & Programming NXP NTAG215 NFC Cards

The physical NFC card stays with the barista behind the counter. When a customer orders a drink, the barista taps this card against the customer's phone to add a stamp.

### Step 1: Create a New Tag in the Staff Portal

1. Open your browser and go to: `https://card.thecaffeineplug.ph/staff/login`
2. Sign in with Dan's owner email and password.
3. Click **Tags** in the top navigation bar (or visit `/staff/tags`).
4. Under **"Create New Tag"**, type a clear label describing where this card will be used:
   - Example labels: `Main Counter Barista 1`, `POS 2 Register`, or `Event Pop-Up 1`.
5. Click the black button: **"Create Tag"**.
6. The new tag appears immediately at the top of the **Active Tags** list.
7. Find the column labeled **Production Tap URL** and click the **Copy** button.
   - The copied URL looks like:  
     `https://card.thecaffeineplug.ph/t/tag_caffeine_plug_8f9a2b3c4d5e6f7g`

### Step 2: Write the URL to the NTAG215 Card

1. Open the **NFC Tools** app on your iPhone or Android phone.
2. Tap the **Write** tab at the top of the screen.
3. Tap **Add a record**.
4. Select **URL / URI** from the list of record types.
5. In the input box, paste the full **Production Tap URL** you copied in Step 1.
6. Tap **OK** in the top-right corner.
7. Tap the **Write / [number] Bytes** button (`TO VERIFY` exact button text in your app version).
8. Hold the blank physical NTAG215 card against your phone:
   - **On iPhone:** Touch the card to the **top back edge** of the iPhone.
   - **On Android:** Touch the card to the **center back** of the Android phone.
9. Hold the card still for 1 second until you feel a vibration and see a green checkmark icon.

---

### Step 3: CRITICAL SECURITY STEP — Password-Protect / Lock the Card

> [!CAUTION]
> **Why this step is critical:**  
> An unlocked NTAG215 card can be rewritten by anyone standing at your counter with a phone and a free NFC app. A bad actor could erase your card or overwrite it with a malicious link. You must protect the card before using it in the shop.

Choose **one** of the two security options below:

#### Option A: Set a Password (Recommended)

This locks the card against unauthorized edits, but allows Dan to reprogram or update the card later if needed.

1. In the **NFC Tools** app, tap the **Other** tab (`TO VERIFY` exact tab location).
2. Scroll down and tap **Set Password** (`TO VERIFY` exact menu item).
3. Enter a 4-byte password. This can be 4 characters or 8 hexadecimal digits (e.g., `TCP2026!`).
4. **Write down this password in a safe owner notebook or password manager.** If you forget it, the card cannot be rewritten.
5. Tap **OK**.
6. Hold the card to your phone to write the password protection bits.
7. The card is now protected. Any phone can read the tap URL to get a stamp, but nobody can alter the card without your password.

#### Option B: Lock Tag (Permanent Read-Only)

This permanently fuses the hardware lock bits on the NTAG215 chip.

1. In the **NFC Tools** app, tap the **Other** tab.
2. Scroll down and tap **Lock tag** (`TO VERIFY` exact menu item).
3. Read the warning dialog confirming that this action cannot be undone.
4. Tap **Confirm / OK**.
5. Hold the card to your phone.
6. _Notice:_ This card is now permanently read-only. It can never be rewritten or modified. If you rotate this tag in the future, you must discard this physical card and program a new one.

---

### Step 4: Test Your Card

1. Close the NFC Tools app completely.
2. Hold your phone next to the card.
3. Your phone should immediately show a notification banner reading `card.thecaffeineplug.ph`.
4. Tap the notification. Your digital loyalty card will open in your browser, and you should see the message: **STAMP COLLECTED (+1 STAMP)**.

---

## 4. Part 3: What to Do If an NFC Card Is Lost, Stolen, or Leaked

If a physical counter card is lost, dropped behind furniture, or if a customer photographed the card's URL link and shared it on social media:

### Step 1: Rotate the Tag in the Staff Portal (Takes 10 Seconds)

1. Open your phone or laptop and go to: `https://card.thecaffeineplug.ph/staff/tags`
2. Sign in with your owner account.
3. Find the compromised card in the **Active Tags** list by its label (e.g. `Main Counter Barista 1`).
4. Click the orange/red **Rotate** button next to that tag.
5. Confirm the action when prompted.

### Step 2: What Happens Immediately

- The database instantly deactivates the old tag:
  - Its status changes to `active = false`.
  - The server records `deactivated_at = now()`.
- **The old link is permanently dead.** Anyone who taps the lost card or opens the leaked link will see an **INACTIVE NFC TAG** warning banner. The server blocks any stamps from being recorded.
- The server generates a brand-new tag with a fresh random ID and a new Production Tap URL.

### Step 3: Program the Replacement Card

1. From `/staff/tags`, copy the new **Production Tap URL** of the newly rotated tag.
2. Take a fresh blank NTAG215 card (or unlock an existing card using your 4-byte password).
3. Program the new URL onto the card using NFC Tools (follow **Part 2, Step 2** and **Step 3**).
4. Hand the replacement card to your barista. The counter is back in business.
