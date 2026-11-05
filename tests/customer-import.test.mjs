import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCustomerImport} from '../shared/customer-import.ts';
test('customer import reads the supplied directory columns without treating task counts or links as customers',()=>{
 const parsed=readCustomerImport('Customer ID\tCustomer Name\tKnown Alias / Project Name\tNumber of Tasks\tLinked Tasks\nC001\tAutoPro DFW\tMASTER | AutoPro DFW\t3\tView related tasks\nC002\tDynamic M Detail\t[Master] Dynamic M Detail\t1\tView related tasks');
 assert.equal(parsed.customers.length,2);assert.equal(parsed.customers[0].name,'AutoPro DFW');assert.equal(parsed.customers[1].alias,'[Master] Dynamic M Detail');
 assert.throws(()=>readCustomerImport('Task Name\tDeadline\nDo work\tToday'),/Customer Name/);
});
