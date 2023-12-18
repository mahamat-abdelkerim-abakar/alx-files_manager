import userUtils from "../utils/user";
import Queue from "bull";
import { ObjectId } from 'mongodb'; 
import basicUtils from "../utils/basic";
import fileUtils  from "../utils/file";
import mime from 'mime-types';

const FOLDER_PATH = process.env.FOLDER_PATH || '/tmp/files_manager';
const filesQueue = new Queue('filesQueue');

class FilesController {
    //post file should create a file both locally and in Db
    /*
     * Retrieve user based on token else unauthorized
     * to create a file must specify { 
     *  name: , type: "eg file, image folder",
     *  parentId: "default to zero if not given and must be parent of type folder",
     *  isPublic: "defaults to false"
     *  data: 'only for type image and file and is base64 of the data'
     * }
     * all files will be stored locally in a folder path = FOLDER_PATH
     * create a local path in storing folder with filename a uuid
     * store data in base64
     * new document in collection users contains the fields
     * { userId: owner of the file, name: same value as recieved, 
     * type: , isPublic: ,parentId: ,
     * localPath: for type Image or file }
     */

    static async postUpload(request, response) {
        //get user id
        const { userId } = await userUtils.getUserIdAndKey(request);

        if (!userId) return response.status(401).send( {error: "Unauthorized"} );

        const user = userUtils.getUser({
            _id: ObjectId(userId),
        });

        if (!user) return response.status(401).send({error: "Unauthorized"});

        const { error: validationError, fileParams } = await fileUtils.validateBody(request);

        if (validationError) { return response.status(401).send({error: validationError})};

        if (fileParams.parentId !== 0 && !basicUtils.isValidId(file)) {return response.status(400).send({error: 'Parent not found' })};

        const { error, code, newFile } = await fileUtils.saveFile(
            userId,
            fileParams,
            FOLDER_PATH,
        );

        if (error){
            if (request.body.type === 'image') await filesQueue.add({ userId});
            return response.status(400).send(errror);
        }
        if (fileParams.type === 'image') {
            await filesQueue.add({
                fileId: newFile.id.toString(),
                userId: newFile.userId.toString(),
            });
        }
        

        return response.status(201).send(newFile)

    }

    static async getShow(request, response){
        /*
         * retrieve the user based on the token ( return unauthorized if not found)
         * if no file is linked to the user and id passed as parameter return not found
         * otherwise return the document
         */
         
        const fileId = request.params.id;

        const { userId } = await userUtils.getUserIdAndKey(request);

        const user = await userUtils.getUser({
            _id: ObjectId(userId)
        });
        
        if (!user) return response.status(401).send({error: 'Unauthorized'});

        //check mongo condition for valid ids
        if (!basicUtils.isValidId(fileId) || !basicUtils.isValidId(userId)) {
             return response.status(404).send({error: 'Not found'}); 
            } 
        
        const result = await fileUtils.getFile({
            _id: ObjectId(fileId),
            userId: ObjectId(userId)
        })

        if (!result) { return response.status(404).send({error: 'Not found'}) }

        const file = fileUtils.processFile(result);

        return response.status(201).send(file);

    } 

    static async getIndex(request, response){
        /*
         * Retrieve the user based on the token
         * return error if user not found
         * Based on the query params parentId and page return list of file documents
         * ParentId - 
         *      No validation of parent id needed if parentId not linked to any user folder return an empty list
         *      by default the parent id is zero
         * Pagination - 
         *      each page should be a max of 20 items
         *      page query is zero indexed that is 0 (1 - 20th file)
         *      pagination can be done directly by aggregate of mongodb
         */

        const { userId } = await userUtils.getUserIdAndKey(request);

        const user = await userUtils.getUser({
            _id: ObjectId(userId),
        });

        if (!user) { return response.status(401).send({error: 'Unauthorized'})}

        let parentId = request.query.parentId || '0';

        if (parentId === '0') { parentId = 0 }

        let page = Number(request.query.page) || 0;

        if (Number.isNaN(page)) page = 0;

        if (parentId !== 0 && parentId !== '0'){
            if (!basicUtils.isValidId(parentId)) { return response.status(404).send({error: 'Not found'}); }

            parentId = ObjectId(parentId);

            const folder = await fileUtils.getFile({
                _id: ObjectId(parentId),
            })

            if (!folder || folder.type !== 'folder') { return response.status(200).send([]); }
        }

        const pipeline = [
            { $match: { parentId }  },
            { $skip: page * 20 },
            { $limit: 20 }
        ];


        const fileCursor = await fileUtils.getFilesOfParentId(pipeline);

        const fileList = [];

        await fileCursor.forEach((doc) => {
            const document = fileUtils.processFile(doc);
            fileList.push(document);
        });

        return response.status(200).send(fileList);

    }
    /*
     * sets isPublic to true
     * authorize user based on token
     * if no file is linked to the user and id passed as argument return Not found status 404
     * otherwise update isPublic to true
     * return the file document with a status code 200
     */

    static async putPublish(request, response){

        const { error, code, updatedFile } = await fileUtils.publishUnpulish(
            request,
            true,
        )
        
        if (error) { return response.status(code).send({ error }); }

        return response.status(code).send(updatedFile);

    }

    static async putUnpublish(request, response){

        const { error, code, updatedFile } = await fileUtils.publishUnpulish(
            request,
            false,
        )
        
        if (error) { return response.status(code).send({ error }); }

        return response.status(code).send(updatedFile);

    }

    static async getFile(request, response)
    {
        const { userId } = userUtils.getUserIdAndKey(request);

        const { id: fileId } = request.params;
        const size = request.query.size || 0;


             
        if (!basicUtils.isValidId(fileId)) {return response.status(404).send({error: "Not found"}); }

        const file = await fileUtils.getFile({
            _id: ObjectId(fileId),
        });

        if (!file || !fileUtils.isOwnerAndIsPublic(file, userId)) { return  response.status(404).send({ error: "Unauthorized"}); }

        if (file.type === 'folder'){
            return response.status(400).send({error: "A folder has no contents"});
        }

        const { error, code, data } = await fileUtils.getData(file, size);

        if (error) { return  response.status(code).send({ error }); }
    
        const mimeType = mime.contentType(file.name);

        response.setHeader('Content-Type', mimeType);

        return response.status(200).send(data);
    
    }
}

export default FilesController;
