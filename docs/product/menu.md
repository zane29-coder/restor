# Menu

Module: `backend/src/modules/catalog` (plus `storage` for images).
Admin screen: `apps/admin-web/src/pages/MenuPage.tsx`.

## Shape

```
Category ──< Product ──< ProductVariant        size options
                      ──< ModifierGroup        shared, many-to-many
                      ──< ProductBranch        per-branch availability
                      ──< ProductIngredient    recipe — see inventory.md
```

A **variant** belongs to one product: Small / Medium / Large, each with a
signed `priceDelta` (a small size may be cheaper than the base).

A **modifier group** is shared across products. "Sauce" is defined once and
attached to every dish that takes one.

## Endpoints

```
GET    /categories              ?includeInactive
POST   /categories
PATCH  /categories/:id
DELETE /categories/:id          refused while it holds products
POST   /categories/reorder

GET    /products                ?categoryId&search
GET    /products/:id
POST   /products
PATCH  /products/:id
DELETE /products/:id
PATCH  /products/:id/availability    per branch — the stop-list

GET    /modifier-groups
POST   /modifier-groups
PATCH  /modifier-groups/:id
DELETE /modifier-groups/:id

POST   /files/images            multipart, returns a URL

GET    /menu/:branchId          public — what a customer sees
```

## minSelect / maxSelect

The two numbers that matter on a modifier group.

- `Sauce 0–2` — optional, pick up to two
- `Size 1–1` — exactly one, forced

Getting them wrong is how a checkout either blocks a valid order or lets a
guest order a pizza with no size. `maxSelect` may not exceed the number of
modifiers in the group; the form refuses it and the server refuses it again.

## Prices

`price` is the base. `discountPrice`, when set and lower, is what is charged —
the UI shows the old one struck through.

**Price edits sit behind their own permission**, `products.price.update`,
separate from `products.update`. A shift manager who may fix a typo in a
description has no business repricing the menu, and the two are different
kinds of mistake. Without the permission the field is shown but disabled, so
they can still see what the price is.

## Stop-list

Per branch, not global. `PATCH /products/:id/availability` with a `branchId`
marks something as run out at one place while it keeps selling elsewhere.
`products.availability.update` is granted to the KITCHEN role — marking
something as run out is a kitchen action, not an admin one.

## Images

Two steps: `POST /files/images` returns a URL, then that URL is patched onto
the product. One combined endpoint would have to either hold the upload until
the product saves or leave an orphaned file behind when it fails.

Capped at 5 MB in the UI. A photo straight off a phone is often 8–12 MB, and
sending that for a 200 px thumbnail wastes the kitchen's connection.

## Deleting

Soft, everywhere. A product that has been sold appears on past orders and in
reports; removing it makes yesterday's figures unexplainable.

A category holding products cannot be deleted — the server refuses it and the
UI disables the button, which avoids a pointless round trip.

## What the UI does not cover

Variants. The API supports them fully; they are set when a product is created
and almost never edited afterwards, so a form would be screen weight nobody
uses. Add one if that turns out to be wrong.

## Permissions

`categories.view|create|update|delete`,
`products.view|create|update|delete`,
`products.price.update`, `products.availability.update`.
