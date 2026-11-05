import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskBoardCategory} from '../shared/task-routing.ts';
test('task routing follows the deliverable before the campaign prefix',()=>{
 assert.equal(taskBoardCategory('[Paid Ads | VizionOne Detail] Optimized video'),'media');
 assert.equal(taskBoardCategory('[Paid Ads] Thay voice video'),'media');
 assert.equal(taskBoardCategory('Content | AutoPro | Edit video from raw footage'),'media');
 assert.equal(taskBoardCategory('Bobbitt Auto | Theme 5 | Content Workbook','Dev Daily Task'),'content');
 assert.equal(taskBoardCategory('Tạo tài khoản WP admin','Dev Daily Task'),'website');
 assert.equal(taskBoardCategory('Website | Clean Cars | Sửa nội dung sai trang Auto Detailing'),'website');
 assert.equal(taskBoardCategory('LSA | AutoPro DFW | Setup Local Services Ads'),'ads');
 assert.equal(taskBoardCategory('Chưa phân loại'),'general');
});
