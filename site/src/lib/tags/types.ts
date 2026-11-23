// SMU course catalogue tags (AREA / TRCK course attributes), written by model/build_gradreq_data.py `build_tags`
// into src/data/real/gradreq/tags.json and served at /data/gradreq/tags.json.
export type TagKind = 'gradreq' | 'core' | 'area' | 'track';

export interface Tag {
  /** stable slug of the full catalogue attribute; used in URLs (/explore/?tag=<id>, Plan B) */
  id: string;
  /** attribute without its "AREA - " / "TRCK - " prefix, e.g. "Grad Req - Sustainability (Intake 2024 onwards)" */
  name: string;
  kind: TagKind;
  /** site course keys carrying the tag (only courses with a page on the site) */
  codes: string[];
  /** active undergraduate catalogue courses carrying the tag, including ones without a site page */
  total: number;
}

export interface TagsFile {
  generator: string;
  tags: Tag[];
}
