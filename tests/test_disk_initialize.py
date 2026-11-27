"""All block devices and commands are simulated; never erase a real disk."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('disk_initialize',Path(__file__).resolve().parents[1]/'python/disk/disk_initialize.py')
disk=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(disk)


def device(name, mounted=None, lvm=False):
    return dict(path='/dev/'+name,name='/dev/'+name,type='disk',size=1024**3,serial=name,wwn='wwn-'+name,
                **{'maj:min':'8:'+str(ord(name[-1]))},ro=False,rm=False,fstype=None,mountpoints=[],
                children=[dict(path='/dev/'+name+'1',type='part',fstype='LVM2_member' if lvm else 'ext4',
                               mountpoints=[mounted] if mounted else [])])


class DiskInitializeTests(unittest.TestCase):
    def setUp(self):
        self.devices=[device('sda','/'),device('sdb'),device('sdc'),device('sdd')]
        self.commands=[]
        self.fail=set()
        self.keep_partitions=set()
        self.volumes=[]
        self.vm_source='/dev/sdd'
        self.addCleanup(patch.stopall)
        patch.object(disk,'run',side_effect=self.run_command).start()
        patch.object(disk.shutil,'which',side_effect=lambda name:'/fake/'+name).start()
        patch.object(disk,'device_stamp',side_effect=lambda path:dict(inode=path,device=path)).start()

    def run_command(self,argv,timeout=30):
        self.commands.append(argv)
        if argv==disk.LSBLK:
            return json.dumps(dict(blockdevices=self.devices))
        if argv[0]=='virsh':
            if 'list' in argv:return 'ccvm\n'
            return '<domain><devices><disk><source dev="'+self.vm_source+'"/></disk></devices></domain>'
        if argv[0]=='pvs':
            return json.dumps(dict(report=[dict(pv=self.volumes)]))
        if argv[0]=='ceph-volume':
            self.assertEqual(argv[1:4],['lvm','zap','--destroy'])
            self.assertEqual(len(argv),5)
            path=argv[-1]
            if path in self.fail:raise RuntimeError('simulated disk failure')
            if path not in self.keep_partitions:
                current=next(value for value in self.devices if value['path']==path)
                child_paths={node['path'] for node in disk.nodes(current)}
                self.volumes=[row for row in self.volumes if row['pv_name'] not in child_paths]
                current['children']=[]
                current['fstype']=None
            return ''
        if argv[0] in ('partprobe','blockdev','udevadm'):return ''
        raise AssertionError(argv)

    def request(self,*paths):
        rows={row['path']:row for row in disk.inventory()}
        return dict(confirmation=disk.CONFIRMATION,devices=[dict(path=path,identity=rows[path]['identity']) for path in paths])

    def zaps(self):
        return [argv for argv in self.commands if argv[0]=='ceph-volume']

    def test_multiple_disks_are_zapped_individually_and_refreshed_before_next_disk(self):
        response=disk.initialize(self.request('/dev/sdb','/dev/sdc'))
        self.assertTrue(response['success'])
        self.assertEqual(self.zaps(),[['ceph-volume','lvm','zap','--destroy','/dev/sdb'],
                                      ['ceph-volume','lvm','zap','--destroy','/dev/sdc']])
        first=self.commands.index(self.zaps()[0]);second=self.commands.index(self.zaps()[1])
        between=self.commands[first+1:second]
        self.assertIn(['partprobe','/dev/sdb'],between)
        self.assertIn(['udevadm','trigger','--action=change','/sys/class/block/sdb'],between)
        self.assertIn(['udevadm','settle','--timeout=30'],between)
        self.assertIn(disk.LSBLK,between)
        self.assertEqual([row['status'] for row in response['results']],['completed','completed'])

    def test_warning_phrase_must_match_exactly(self):
        request=self.request('/dev/sdb')
        for value in ['',True,'확인했습니다.',' 확인했습니다','확인했습니다 ']:
            with self.subTest(value=value),self.assertRaises(ValueError):
                disk.initialize(dict(request,confirmation=value))
        self.assertEqual(self.zaps(),[])

    def test_root_and_running_vm_disks_cannot_be_initialized(self):
        for path in ['/dev/sda','/dev/sdd']:
            with self.subTest(path=path),self.assertRaises(ValueError):
                disk.initialize(self.request('/dev/sdb',path))
        self.assertEqual(self.zaps(),[],'the entire batch must be checked before the first zap')

    def test_swap_readonly_and_mapper_devices_are_blocked(self):
        self.devices[1]['children'][0]['fstype']='swap'
        self.devices[2]['ro']=True
        self.devices[3]['children'][0]['type']='crypt'
        rows=disk.inventory()
        self.assertFalse(any(row['can_initialize'] for row in rows))

    def test_changed_disk_identity_rejects_the_batch(self):
        request=self.request('/dev/sdb')
        self.devices[1]['serial']='replacement-disk'
        with self.assertRaisesRegex(ValueError,'변경'):
            disk.initialize(request)
        self.assertEqual(self.zaps(),[])

    def test_duplicate_or_unknown_targets_are_rejected(self):
        request=self.request('/dev/sdb')
        for paths in [request['devices']*2,[dict(path='/dev/sdb; rm -rf /',identity='a'*64)],[]]:
            with self.subTest(paths=paths),self.assertRaises(ValueError):
                disk.initialize(dict(request,devices=paths))
        self.assertEqual(self.zaps(),[])

    def test_leftover_kernel_partitions_are_not_reported_as_success(self):
        self.keep_partitions.add('/dev/sdb')
        response=disk.initialize(self.request('/dev/sdb'))
        self.assertFalse(response['success'])
        self.assertEqual(response['results'][0]['status'],'failed')
        self.assertIn('데이터 삭제 후',response['results'][0]['message'])
        self.assertIn('해제되지',response['results'][0]['message'])

    def test_partial_failure_keeps_per_disk_results(self):
        self.fail.add('/dev/sdb')
        response=disk.initialize(self.request('/dev/sdb','/dev/sdc'))
        self.assertFalse(response['success'])
        self.assertEqual([row['status'] for row in response['results']],['failed','completed'])
        self.assertIn('일부 삭제',response['results'][0]['message'])
        self.assertEqual(len(self.zaps()),2)

    def test_blockdev_is_used_when_partprobe_is_missing(self):
        with patch.object(disk.shutil,'which',side_effect=lambda name:None if name=='partprobe' else '/fake/'+name):
            response=disk.initialize(self.request('/dev/sdb'))
        self.assertTrue(response['success'])
        self.assertIn(['blockdev','--rereadpt','/dev/sdb'],self.commands)

    def test_a_shared_vg_cannot_erase_unselected_disks(self):
        self.devices[1]=device('sdb',lvm=True)
        self.volumes=[dict(pv_name='/dev/sdb1',vg_name='shared'),dict(pv_name='/dev/sdc1',vg_name='shared')]
        with self.assertRaisesRegex(ValueError,'선택하지 않은'):
            disk.initialize(self.request('/dev/sdb'))
        self.assertEqual(self.zaps(),[])

    def test_selected_vg_members_are_processed_one_at_a_time(self):
        self.devices[1]=device('sdb',lvm=True)
        self.devices[2]=device('sdc',lvm=True)
        self.volumes=[dict(pv_name='/dev/sdb1',vg_name='shared'),dict(pv_name='/dev/sdc1',vg_name='shared')]
        self.assertTrue(disk.initialize(self.request('/dev/sdb','/dev/sdc'))['success'])
        self.assertEqual(len(self.zaps()),2)

    def test_vm_inventory_failure_blocks_erase(self):
        with patch.object(disk,'vm_disks',side_effect=RuntimeError('libvirt unavailable')):
            rows=disk.inventory()
        self.assertFalse(any(row['can_initialize'] for row in rows))

    def test_public_inventory_has_no_internal_device_tree(self):
        snapshot=disk.public_inventory()
        self.assertEqual(snapshot['code'],200)
        self.assertNotIn('_nodes',snapshot['disks'][0])


if __name__=='__main__':unittest.main()
