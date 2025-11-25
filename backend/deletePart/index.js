Resources:
  DeletePartFunction:
    Properties:
      Events:
        DeletePartById:
          Type: Api
          Properties:
            Path: /parts/delete/{id}
            Method: POST