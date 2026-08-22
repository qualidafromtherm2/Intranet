import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SalesMapScreen } from './SalesMapScreen'
const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}})
afterEach(()=>vi.unstubAllGlobals())
describe('SalesMapScreen',()=>{it('renders ranking, filters, export and timeline with GET-only contracts',async()=>{const fetchMock=vi.fn().mockImplementation((url:string)=>Promise.resolve(json(url.includes('timeline=1')?{ok:true,timeline_rows:[{mes:'2026-08',uf:'SC',valor_total:100}]}:{ok:true,rows:[{uf:'SC',valor_total:100,cliente_destaque:'ACME'}]})));vi.stubGlobal('fetch',fetchMock);render(<SalesMapScreen/>);expect(await screen.findByText('ACME')).toBeInTheDocument();expect(screen.getByText('Distribuição por estado')).toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:'Timeline'}));expect(await screen.findByRole('button',{name:'Parar'})).toBeInTheDocument();expect(fetchMock.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true)})})
