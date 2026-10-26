import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { dateIndex, parseRecordContract } from '../../../lib/record-days';

export async function getStaticPaths() {
  return (await getCollection('experiments')).flatMap(experiment => {
    const contract = parseRecordContract(experiment.body, experiment.data.id);
    return contract ? [{params: {slug: experiment.id}, props: {index: dateIndex(contract)}}] : [];
  });
}
export const GET: APIRoute = ({props}) => new Response(JSON.stringify(props.index), {headers: {'Content-Type': 'application/json; charset=utf-8'}});
