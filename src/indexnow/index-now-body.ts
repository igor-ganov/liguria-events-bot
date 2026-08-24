const HOST = 'dovego.it';

export type IndexNowBody = Readonly<{
  host: string;
  key: string;
  keyLocation: string;
  urlList: readonly string[];
}>;

/** The submission. `keyLocation` is how the protocol proves the sender owns
 *  the host: the key must be readable at that URL, or the batch is rejected. */
export const indexNowBody = (key: string, urls: readonly string[]): IndexNowBody => ({
  host: HOST,
  key,
  keyLocation: `https://${HOST}/${key}.txt`,
  urlList: urls,
});
