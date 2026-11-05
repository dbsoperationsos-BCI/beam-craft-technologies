/*
 * An asset's Category and Type (subcategory) as the screens show them. An asset whose subcategory was
 * "Others" is filed under its Category alone, with the typed name beside it - so its Type reads
 * "Others – <typed name>", never the Category's own name a second time.
 */

/** The top category: the category's parent, or the category itself when it is the top. */
export const assetCategoryLabel = (asset) => asset?.category?.parent?.name || asset?.category?.name || null;

/** The subcategory: the one chosen from the list, or "Others – <typed name>". */
export const assetTypeLabel = (asset) => (asset?.subCategoryOther ? `Others – ${asset.subCategoryOther}` : asset?.category?.name || null);
